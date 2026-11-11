//! Loopback-only local dashboard. This module never contacts an AI provider.
use crate::snapshot::{parse_browser_report, DomainError};
use crate::store::Store;
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, Request, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;

mod assets {
    include!(concat!(env!("OUT_DIR"), "/frontend_assets.rs"));
}

const BODY_LIMIT: usize = 32 * 1024;
const BOOTSTRAP_LIFETIME: Duration = Duration::from_secs(120);
const SESSION_LIFETIME: Duration = Duration::from_secs(8 * 60 * 60);
const REQUEST_KEY: &str = "x-ai-quota-session";

#[derive(Debug)]
pub struct ServerError(&'static str);
impl std::fmt::Display for ServerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.0)
    }
}
impl std::error::Error for ServerError {}

#[derive(Clone, Copy)]
struct ApiError(StatusCode, &'static str);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
impl From<DomainError> for ApiError {
    fn from(error: DomainError) -> Self {
        let code = error.code();
        let status = match code {
            "account_not_found" => StatusCode::NOT_FOUND,
            "older_snapshot" | "snapshot_conflict" => StatusCode::CONFLICT,
            "storage_unavailable" | "invalid_database" | "unsupported_database_version" => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            _ => StatusCode::BAD_REQUEST,
        };
        Self(status, code)
    }
}

struct Session {
    cookie_hash: [u8; 32],
    request_hash: [u8; 32],
    expires: Instant,
}
struct Authorization {
    bootstrap_hash: [u8; 32],
    bootstrap_expires: Instant,
    bootstrap_used: bool,
    session: Option<Session>,
}
struct AppState {
    store: Arc<Mutex<Store>>,
    authorization: Mutex<Authorization>,
    origin: String,
    host: String,
    cookie_name: String,
}
type Shared = Arc<AppState>;

fn token() -> Result<String, ServerError> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| ServerError("random_source_unavailable"))?;
    let mut result = String::with_capacity(64);
    for byte in bytes {
        use std::fmt::Write;
        write!(result, "{byte:02x}").map_err(|_| ServerError("random_source_unavailable"))?;
    }
    Ok(result)
}
fn digest(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}
fn matches_hash(value: &str, expected: &[u8; 32]) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        && bool::from(digest(value).ct_eq(expected))
}

pub fn frontend_available() -> bool {
    assets::FRONTEND_AVAILABLE
}

/// The returned bootstrap is used once to open a local browser fragment. Never
/// print it, persist it, include it in a URL query, or send it to another host.
pub fn make_app(store: Store, origin: String) -> Result<(Router, String), ServerError> {
    let port = origin
        .strip_prefix("http://127.0.0.1:")
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port != 0)
        .ok_or(ServerError("loopback_origin_required"))?;
    if origin != format!("http://127.0.0.1:{port}") {
        return Err(ServerError("loopback_origin_required"));
    }
    let bootstrap = token()?;
    let state = Arc::new(AppState {
        store: Arc::new(Mutex::new(store)),
        authorization: Mutex::new(Authorization {
            bootstrap_hash: digest(&bootstrap),
            bootstrap_expires: Instant::now() + BOOTSTRAP_LIFETIME,
            bootstrap_used: false,
            session: None,
        }),
        host: format!("127.0.0.1:{port}"),
        cookie_name: format!("ai_quota_session_{port}"),
        origin,
    });
    let router = Router::new()
        .route(
            "/api/health",
            get(|| async { Json(json!({"status":"ok", "version":env!("CARGO_PKG_VERSION")})) }),
        )
        .route("/api/session", post(start_session).delete(lock_session))
        .route("/api/accounts", get(list_accounts).post(create_account))
        .route("/api/accounts/{id}", delete(delete_account))
        .route("/api/accounts/{id}/import", post(import_snapshot))
        .route("/api/snapshots", get(list_snapshots))
        .fallback(static_asset)
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(middleware::from_fn_with_state(state.clone(), security))
        .with_state(state);
    Ok((router, bootstrap))
}

fn single_header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?.to_str().ok()?;
    if values.next().is_some() {
        return None;
    }
    Some(value)
}
fn credentials(headers: &HeaderMap, state: &AppState) -> bool {
    let Some(request_key) = single_header(headers, REQUEST_KEY) else {
        return false;
    };
    let mut cookie = None;
    for header in headers.get_all(header::COOKIE) {
        let Ok(text) = header.to_str() else {
            return false;
        };
        for part in text.split(';') {
            if let Some((key, value)) = part.trim().split_once('=') {
                if key == state.cookie_name {
                    if cookie.is_some() {
                        return false;
                    }
                    cookie = Some(value);
                }
            }
        }
    }
    let Some(cookie) = cookie else {
        return false;
    };
    let Ok(auth) = state.authorization.lock() else {
        return false;
    };
    auth.session.as_ref().is_some_and(|session| {
        Instant::now() < session.expires
            && matches_hash(cookie, &session.cookie_hash)
            && matches_hash(request_key, &session.request_hash)
    })
}

async fn security(State(state): State<Shared>, request: Request<Body>, next: Next) -> Response {
    let is_api = request.uri().path().starts_with("/api/");
    let mutating = !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    );
    let origin_ok = if request.headers().contains_key(header::ORIGIN) {
        single_header(request.headers(), "origin") == Some(&state.origin)
    } else {
        !is_api || !mutating
    };
    let fetch_ok = !is_api
        || !request.headers().contains_key("sec-fetch-site")
        || matches!(
            single_header(request.headers(), "sec-fetch-site"),
            Some("same-origin" | "none")
        );
    let public = (request.uri().path() == "/api/session" && request.method() == Method::POST)
        || (request.uri().path() == "/api/health" && request.method() == Method::GET);
    let mut response = if single_header(request.headers(), "host") != Some(&state.host)
        || !origin_ok
        || !fetch_ok
    {
        ApiError(StatusCode::FORBIDDEN, "request_origin_rejected").into_response()
    } else if is_api && !public && !credentials(request.headers(), &state) {
        ApiError(StatusCode::UNAUTHORIZED, "authorization_required").into_response()
    } else if is_api
        && request.method() == Method::POST
        && single_header(request.headers(), "content-type")
            .is_none_or(|value| value.split(';').next().map(str::trim) != Some("application/json"))
    {
        ApiError(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "json_content_type_required",
        )
        .into_response()
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("content-security-policy", HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"));
    response
}

type InputBytes = Result<Bytes, axum::extract::rejection::BytesRejection>;
fn decode<T: DeserializeOwned>(input: InputBytes) -> Result<T, ApiError> {
    let bytes = input.map_err(|_| ApiError(StatusCode::PAYLOAD_TOO_LARGE, "request_too_large"))?;
    if bytes.len() > BODY_LIMIT {
        return Err(ApiError(StatusCode::PAYLOAD_TOO_LARGE, "request_too_large"));
    }
    serde_json::from_slice(&bytes).map_err(|_| ApiError(StatusCode::BAD_REQUEST, "invalid_json"))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BootstrapInput {
    bootstrap: String,
}

async fn start_session(
    State(state): State<Shared>,
    input: InputBytes,
) -> Result<Response, ApiError> {
    let body: BootstrapInput = decode(input)?;
    let cookie = token().map_err(|_| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "random_source_unavailable",
        )
    })?;
    let request_key = token().map_err(|_| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "random_source_unavailable",
        )
    })?;
    {
        let mut auth = state.authorization.lock().map_err(|_| {
            ApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                "authorization_unavailable",
            )
        })?;
        if auth.bootstrap_used
            || Instant::now() >= auth.bootstrap_expires
            || !matches_hash(&body.bootstrap, &auth.bootstrap_hash)
        {
            return Err(ApiError(
                StatusCode::UNAUTHORIZED,
                "bootstrap_expired_or_invalid",
            ));
        }
        auth.bootstrap_used = true;
        auth.session = Some(Session {
            cookie_hash: digest(&cookie),
            request_hash: digest(&request_key),
            expires: Instant::now() + SESSION_LIFETIME,
        });
    }
    let mut response = Json(json!({"request_token":request_key})).into_response();
    let value = format!(
        "{}={cookie}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=28800",
        state.cookie_name
    );
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&value).map_err(|_| {
            ApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                "authorization_unavailable",
            )
        })?,
    );
    Ok(response)
}
async fn lock_session(State(state): State<Shared>) -> Result<Response, ApiError> {
    state
        .authorization
        .lock()
        .map_err(|_| {
            ApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                "authorization_unavailable",
            )
        })?
        .session = None;
    let mut response = StatusCode::NO_CONTENT.into_response();
    let value = format!(
        "{}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0",
        state.cookie_name
    );
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&value).map_err(|_| {
            ApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                "authorization_unavailable",
            )
        })?,
    );
    Ok(response)
}

async fn database<T: Send + 'static>(
    state: &Shared,
    action: impl FnOnce(&Store) -> Result<T, DomainError> + Send + 'static,
) -> Result<T, ApiError> {
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || {
        let store = store
            .lock()
            .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "storage_unavailable"))?;
        action(&store).map_err(ApiError::from)
    })
    .await
    .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "storage_unavailable"))?
}
async fn list_accounts(State(state): State<Shared>) -> Result<Json<serde_json::Value>, ApiError> {
    let accounts = database(&state, |store| store.list_accounts()).await?;
    Ok(Json(json!({"accounts":accounts})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountInput {
    label: String,
}
async fn create_account(
    State(state): State<Shared>,
    input: InputBytes,
) -> Result<Response, ApiError> {
    let body: AccountInput = decode(input)?;
    let account = database(&state, move |store| store.create_account(&body.label)).await?;
    Ok((StatusCode::CREATED, Json(account)).into_response())
}
async fn delete_account(
    State(state): State<Shared>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    database(&state, move |store| store.delete_account(&id)).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn list_snapshots(State(state): State<Shared>) -> Result<Json<serde_json::Value>, ApiError> {
    let snapshots = database(&state, |store| store.list_snapshots()).await?;
    Ok(Json(json!({"snapshots":snapshots})))
}
async fn import_snapshot(
    State(state): State<Shared>,
    Path(id): Path<String>,
    input: InputBytes,
) -> Result<Response, ApiError> {
    let value: serde_json::Value = decode(input)?;
    let observation = parse_browser_report(&value, Utc::now()).map_err(ApiError::from)?;
    let snapshot = database(&state, move |store| {
        store.import_snapshot(&id, &observation, Utc::now())
    })
    .await?;
    Ok(Json(snapshot).into_response())
}
async fn static_asset(uri: Uri) -> Response {
    if uri.path().starts_with("/api/") {
        return ApiError(StatusCode::NOT_FOUND, "route_not_found").into_response();
    }
    let path = match uri.path() {
        "/" => "index.html",
        value => value.trim_start_matches('/'),
    };
    if let Some((_, bytes, mime)) = assets::ASSETS.iter().find(|(name, _, _)| *name == path) {
        let mut response = Body::from(*bytes).into_response();
        response
            .headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
        return response;
    }
    StatusCode::NOT_FOUND.into_response()
}
