//! HTTP contracts for the local prototype. Every account and observation is synthetic.
use ai_quota_preflight::server::make_app;
use ai_quota_preflight::store::Store;
use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::Router;
use chrono::{Duration, SecondsFormat, Utc};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tempfile::TempDir;
use tower::ServiceExt;

const ORIGIN: &str = "http://127.0.0.1:31234";
const HOST: &str = "127.0.0.1:31234";
const SECRET: &str = "SYNTHETIC_TOKEN_MUST_NOT_LEAK";

struct Response {
    status: StatusCode,
    headers: HeaderMap,
    bytes: Vec<u8>,
}

impl Response {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.bytes).expect("API response must be JSON")
    }

    fn assert_safe_error(&self, expected: StatusCode) {
        assert_eq!(self.status, expected);
        let body = self.json();
        assert!(body.get("error").is_some_and(Value::is_string));
        assert!(!String::from_utf8_lossy(&self.bytes).contains(SECRET));
    }
}

struct Harness {
    app: Router,
    bootstrap: String,
    cookie: Option<String>,
    request_token: Option<String>,
    _directory: TempDir,
}

impl Harness {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(&directory.path().join("quota.sqlite")).unwrap();
        let (app, bootstrap) = make_app(store, ORIGIN.to_owned()).unwrap();
        Self {
            app,
            bootstrap,
            cookie: None,
            request_token: None,
            _directory: directory,
        }
    }

    fn request(&self, method: Method, path: &str, body: Body) -> Request<Body> {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, HOST)
            .header(header::ORIGIN, ORIGIN)
            .header(header::CONTENT_TYPE, "application/json")
            .body(body)
            .unwrap();
        if let Some(cookie) = &self.cookie {
            request
                .headers_mut()
                .insert(header::COOKIE, cookie.parse().unwrap());
        }
        if let Some(token) = &self.request_token {
            request
                .headers_mut()
                .insert("x-ai-quota-session", token.parse().unwrap());
        }
        request
    }

    async fn send(&self, request: Request<Body>) -> Response {
        let response = self.app.clone().oneshot(request).await.unwrap();
        let (parts, body) = response.into_parts();
        Response {
            status: parts.status,
            headers: parts.headers,
            bytes: body.collect().await.unwrap().to_bytes().to_vec(),
        }
    }

    async fn json(&self, method: Method, path: &str, body: Value) -> Response {
        self.send(self.request(method, path, Body::from(body.to_string())))
            .await
    }

    async fn get(&self, path: &str) -> Response {
        self.send(self.request(Method::GET, path, Body::empty()))
            .await
    }

    async fn authorize(&mut self) {
        let response = self
            .json(
                Method::POST,
                "/api/session",
                json!({"bootstrap": self.bootstrap}),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK);
        let body = response.json();
        let token = body["request_token"].as_str().unwrap().to_owned();
        assert!(
            token.len() >= 32,
            "request token must have substantial entropy"
        );
        assert!(
            token != self.bootstrap,
            "bootstrap and request verifier differ"
        );
        let cookie = response
            .headers
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap();
        let lower = cookie.to_ascii_lowercase();
        assert!(lower.contains("httponly"));
        assert!(lower.contains("samesite=strict"));
        assert!(lower.contains("path=/api"));
        // The prototype is HTTP loopback. HTTPS publication has a separate policy.
        assert!(!lower.contains("; secure"));
        self.cookie = Some(cookie.split(';').next().unwrap().to_owned());
        self.request_token = Some(token);
    }

    async fn account(&self, label: &str) -> String {
        let response = self
            .json(Method::POST, "/api/accounts", json!({"label": label}))
            .await;
        assert_eq!(response.status, StatusCode::CREATED);
        let body = response.json();
        assert_eq!(body["label"], label);
        body["id"].as_str().unwrap().to_owned()
    }
}

fn observation(minutes_ago: i64, remaining: f64, credits: Option<&str>) -> Value {
    let read =
        (Utc::now() - Duration::minutes(minutes_ago)).to_rfc3339_opts(SecondsFormat::Millis, true);
    json!({
        "schema_version":1,
        "provider":"openai",
        "source":"user_initiated_browser_selection",
        "source_page":"https://chatgpt.com/settings/usage?tab=overview",
        "page_read_at":read,
        "server_observed_at":null,
        "freshness":"unknown",
        "account":null,
        "provider_pool_id":null,
        "applies_to_products":null,
        "real_account_verified":false,
        "weekly":{
            "window":"weekly",
            "remaining_percent":remaining,
            "resets_at":null,
            "reset_relative":{"label":"3d 4h","seconds":273600,"precision":"estimated_from_display"}
        },
        "credits":credits.map(|balance| json!({"meter_kind":"consumer_credit_balance","balance":balance,"unit":"credits"}))
    })
}

#[tokio::test]
async fn health_is_public_and_contains_no_private_paths_or_authorization() {
    let harness = Harness::new();
    let response = harness.get("/api/health").await;
    assert_eq!(response.status, StatusCode::OK);
    assert!(response.json().is_object());
    let text = String::from_utf8_lossy(&response.bytes);
    assert!(!text.contains(&harness.bootstrap));
    assert!(!text.contains(&harness._directory.path().to_string_lossy().to_string()));
    assert!(!text.contains("quota.sqlite"));
}

#[tokio::test]
async fn every_data_endpoint_requires_both_cookie_and_request_verifier() {
    let mut harness = Harness::new();
    harness
        .get("/api/accounts")
        .await
        .assert_safe_error(StatusCode::UNAUTHORIZED);
    harness
        .get("/api/snapshots")
        .await
        .assert_safe_error(StatusCode::UNAUTHORIZED);
    harness.authorize().await;
    let account = harness.account("合成账户").await;
    let cookie = harness.cookie.take();
    harness
        .get("/api/accounts")
        .await
        .assert_safe_error(StatusCode::UNAUTHORIZED);
    harness.cookie = cookie;
    let token = harness.request_token.take();
    harness
        .get("/api/snapshots")
        .await
        .assert_safe_error(StatusCode::UNAUTHORIZED);
    harness
        .json(
            Method::DELETE,
            &format!("/api/accounts/{account}"),
            Value::Null,
        )
        .await
        .assert_safe_error(StatusCode::UNAUTHORIZED);
    harness.request_token = token;
    harness.request_token = Some(SECRET.to_owned());
    harness
        .get("/api/accounts")
        .await
        .assert_safe_error(StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn bootstrap_is_single_use_and_never_returned_as_an_api_key() {
    let mut harness = Harness::new();
    harness.authorize().await;
    let response = harness
        .json(
            Method::POST,
            "/api/session",
            json!({"bootstrap":harness.bootstrap}),
        )
        .await;
    response.assert_safe_error(StatusCode::UNAUTHORIZED);
    assert!(response.headers.get(header::SET_COOKIE).is_none());
    assert!(!String::from_utf8_lossy(&response.bytes).contains(&harness.bootstrap));
    assert_eq!(harness.get("/api/accounts").await.status, StatusCode::OK);
}

#[tokio::test]
async fn unknown_host_origin_and_fetch_site_cannot_read_or_bootstrap() {
    let mut harness = Harness::new();
    let mut wrong_host = harness.request(
        Method::POST,
        "/api/session",
        Body::from(json!({"bootstrap":harness.bootstrap}).to_string()),
    );
    wrong_host
        .headers_mut()
        .insert(header::HOST, "attacker.invalid".parse().unwrap());
    harness
        .send(wrong_host)
        .await
        .assert_safe_error(StatusCode::FORBIDDEN);
    let mut wrong_origin = harness.request(
        Method::POST,
        "/api/session",
        Body::from(json!({"bootstrap":harness.bootstrap}).to_string()),
    );
    wrong_origin
        .headers_mut()
        .insert(header::ORIGIN, "https://attacker.invalid".parse().unwrap());
    harness
        .send(wrong_origin)
        .await
        .assert_safe_error(StatusCode::FORBIDDEN);
    harness.authorize().await;
    let mut cross_site = harness.request(Method::GET, "/api/accounts", Body::empty());
    cross_site
        .headers_mut()
        .insert("sec-fetch-site", "cross-site".parse().unwrap());
    harness
        .send(cross_site)
        .await
        .assert_safe_error(StatusCode::FORBIDDEN);
    let mut other_port = harness.request(Method::GET, "/api/accounts", Body::empty());
    other_port
        .headers_mut()
        .insert(header::ORIGIN, "http://127.0.0.1:31235".parse().unwrap());
    harness
        .send(other_port)
        .await
        .assert_safe_error(StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mutations_require_origin_even_when_the_two_session_parts_are_valid() {
    let mut harness = Harness::new();
    harness.authorize().await;
    let mut request = harness.request(
        Method::POST,
        "/api/accounts",
        Body::from(json!({"label":"synthetic"}).to_string()),
    );
    request.headers_mut().remove(header::ORIGIN);
    harness
        .send(request)
        .await
        .assert_safe_error(StatusCode::FORBIDDEN);
    assert_eq!(
        harness.get("/api/accounts").await.json()["accounts"],
        json!([])
    );
    // Browsers may omit Origin on a same-origin GET. The session pair still
    // protects reads, while the mutation above must have an explicit Origin.
    let mut read = harness.request(Method::GET, "/api/accounts", Body::empty());
    read.headers_mut().remove(header::ORIGIN);
    assert_eq!(harness.send(read).await.status, StatusCode::OK);
}

#[tokio::test]
async fn mutation_content_type_is_explicit_and_unknown_routes_are_safe() {
    let mut harness = Harness::new();
    let mut bootstrap = harness.request(
        Method::POST,
        "/api/session",
        Body::from(json!({"bootstrap":harness.bootstrap}).to_string()),
    );
    bootstrap.headers_mut().remove(header::CONTENT_TYPE);
    harness
        .send(bootstrap)
        .await
        .assert_safe_error(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    harness.authorize().await;
    let mut create = harness.request(
        Method::POST,
        "/api/accounts",
        Body::from(json!({"label":"synthetic"}).to_string()),
    );
    create
        .headers_mut()
        .insert(header::CONTENT_TYPE, "text/plain".parse().unwrap());
    harness
        .send(create)
        .await
        .assert_safe_error(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    harness
        .get("/api/not-a-route")
        .await
        .assert_safe_error(StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn profiles_keep_latest_observations_separate_and_delete_cascades() {
    let mut harness = Harness::new();
    harness.authorize().await;
    let first = harness.account("合成账户甲").await;
    let second = harness.account("合成账户乙").await;
    assert_ne!(first, second);
    let response = harness
        .json(
            Method::POST,
            &format!("/api/accounts/{first}/import"),
            observation(1, 37.0, Some("12.75")),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.json()["account_id"], first);
    let snapshots = harness.get("/api/snapshots").await.json();
    let rows = snapshots["snapshots"].as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["account_id"], first);
    assert_eq!(rows[0]["observation"]["freshness"], "unknown");
    assert!(rows[0]["observation"]["server_observed_at"].is_null());
    assert_eq!(
        harness
            .json(
                Method::DELETE,
                &format!("/api/accounts/{first}"),
                Value::Null
            )
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        harness.get("/api/snapshots").await.json()["snapshots"],
        json!([])
    );
    let accounts = harness.get("/api/accounts").await.json();
    assert_eq!(accounts["accounts"].as_array().unwrap().len(), 1);
    assert_eq!(accounts["accounts"][0]["id"], second);
}

#[tokio::test]
async fn real_zero_is_preserved_and_unknown_credits_do_not_turn_into_zero() {
    let mut harness = Harness::new();
    harness.authorize().await;
    let first = harness.account("合成零值").await;
    let response = harness
        .json(
            Method::POST,
            &format!("/api/accounts/{first}/import"),
            observation(1, 0.0, None),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.json()["observation"]["remaining_percent"], 0.0);
    assert!(response.json()["observation"]["credits_balance"].is_null());
    let second = harness.account("合成空余额").await;
    let response = harness
        .json(
            Method::POST,
            &format!("/api/accounts/{second}/import"),
            observation(1, 37.0, Some("0")),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.json()["observation"]["remaining_percent"], 37.0);
    assert_eq!(response.json()["observation"]["credits_balance"], "0");
}

#[tokio::test]
async fn older_import_cannot_overwrite_a_newer_observation_and_duplicates_are_idempotent() {
    let mut harness = Harness::new();
    harness.authorize().await;
    let account = harness.account("合成时间窗口").await;
    let path = format!("/api/accounts/{account}/import");
    let report = observation(1, 37.0, Some("12.75"));
    let first = harness.json(Method::POST, &path, report.clone()).await;
    assert_eq!(first.status, StatusCode::OK);
    let duplicate = harness.json(Method::POST, &path, report).await;
    assert_eq!(duplicate.status, StatusCode::OK);
    assert_eq!(first.json()["imported_at"], duplicate.json()["imported_at"]);
    harness
        .json(Method::POST, &path, observation(60, 91.0, Some("99")))
        .await
        .assert_safe_error(StatusCode::CONFLICT);
    let data = harness.get("/api/snapshots").await.json();
    assert_eq!(
        data["snapshots"][0]["observation"]["remaining_percent"],
        37.0
    );
}

#[tokio::test]
async fn elapsed_relative_reset_never_restores_the_imported_allowance() {
    let mut harness = Harness::new();
    harness.authorize().await;
    let account = harness.account("合成预计重置").await;
    let mut report = observation(5, 37.0, Some("12.75"));
    report["weekly"]["reset_relative"] =
        json!({"label":"1m","seconds":60,"precision":"estimated_from_display"});
    let response = harness
        .json(
            Method::POST,
            &format!("/api/accounts/{account}/import"),
            report,
        )
        .await;
    assert_eq!(response.status, StatusCode::OK);
    let data = harness.get("/api/snapshots").await.json();
    assert_eq!(
        data["snapshots"][0]["observation"]["remaining_percent"],
        37.0
    );
    assert_eq!(
        data["snapshots"][0]["observation"]["relative_reset_seconds"],
        60
    );
}

#[tokio::test]
async fn raw_errors_unknown_credentials_and_false_verification_never_enter_storage() {
    let mut harness = Harness::new();
    harness.authorize().await;
    let account = harness.account("合成错误").await;
    let path = format!("/api/accounts/{account}/import");
    let response = harness
        .send(harness.request(
            Method::POST,
            &path,
            Body::from(format!("{{broken-{SECRET}")),
        ))
        .await;
    response.assert_safe_error(StatusCode::BAD_REQUEST);
    let mut report = observation(1, 37.0, Some("12.75"));
    report["accessToken"] = json!(SECRET);
    harness
        .json(Method::POST, &path, report)
        .await
        .assert_safe_error(StatusCode::BAD_REQUEST);
    let mut report = observation(1, 37.0, Some("12.75"));
    report["real_account_verified"] = json!(true);
    harness
        .json(Method::POST, &path, report)
        .await
        .assert_safe_error(StatusCode::BAD_REQUEST);
    let mut report = observation(1, 37.0, Some("12.75"));
    report["weekly"]["resets_at"] = json!("2031-01-01T00:00:00.000Z");
    harness
        .json(Method::POST, &path, report)
        .await
        .assert_safe_error(StatusCode::BAD_REQUEST);
    assert_eq!(
        harness.get("/api/snapshots").await.json()["snapshots"],
        json!([])
    );
}

#[tokio::test]
async fn bodies_above_the_limit_are_rejected_without_reflecting_them() {
    let mut harness = Harness::new();
    harness.authorize().await;
    let body = format!("{{\"label\":\"{SECRET}{}\"}}", "x".repeat(33 * 1024));
    let response = harness
        .send(harness.request(Method::POST, "/api/accounts", Body::from(body)))
        .await;
    response.assert_safe_error(StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        harness.get("/api/accounts").await.json()["accounts"],
        json!([])
    );
}

#[tokio::test]
async fn security_headers_do_not_depend_on_authorization_success() {
    let harness = Harness::new();
    for path in ["/api/health", "/api/accounts"] {
        let response = harness.get(path).await;
        assert!(response.headers[header::CACHE_CONTROL]
            .to_str()
            .unwrap()
            .contains("no-store"));
        assert_eq!(response.headers[header::REFERRER_POLICY], "no-referrer");
        assert_eq!(response.headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        let csp = response.headers[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(csp.contains("script-src 'self'"));
        assert!(csp.contains("connect-src 'self'"));
        assert!(csp.contains("frame-ancestors 'none'"));
        assert!(!csp.contains("https://"));
        assert!(response
            .headers
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
    }
}

#[tokio::test]
async fn logout_invalidates_the_cookie_and_request_key_pair() {
    let mut harness = Harness::new();
    harness.authorize().await;
    let response = harness
        .json(Method::DELETE, "/api/session", Value::Null)
        .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    harness
        .get("/api/accounts")
        .await
        .assert_safe_error(StatusCode::UNAUTHORIZED);
    harness
        .get("/api/snapshots")
        .await
        .assert_safe_error(StatusCode::UNAUTHORIZED);
}
