export class ApiError extends Error {constructor(public code: string){super(code)}}
export async function api<T>(path: string,body?: unknown): Promise<T> {
 const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 const data: unknown=await response.json();if(!response.ok){const error=data&&typeof data==='object'&&'error' in data?data.error:null;throw new ApiError(typeof error==='string'?error:'internal_error')}return data as T;
}
