// Pure presentation: unknown balances stay unknown; reset expiry never changes values.
export function formatValue(primary){
 if(!primary||primary.value===null||primary.value===undefined||primary.value===''||!Number.isFinite(Number(primary.value)))return '—';
 const n=new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(Number(primary.value));
 return primary.unit==='percent'?`${n}%`:`${n} ${primary.unit}`;
}
export function countdown(resetAt,now=Date.now()){
 const at=Date.parse(resetAt);if(!Number.isFinite(at))return '重置时间未知';
 const seconds=Math.ceil((at-now)/1000);if(seconds<=0)return '重置待确认';
 const days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
 return days?`${days}天 ${hours}时后重置`:hours?`${hours}时 ${minutes}分后重置`:`${minutes}分 ${rest}秒后重置`;
}
export function relativeTime(value,now=Date.now()){
 const at=Date.parse(value);if(!Number.isFinite(at))return '尚未同步';const seconds=Math.max(0,Math.floor((now-at)/1000));
 return seconds<60?'刚刚同步':seconds<3600?`${Math.floor(seconds/60)}分钟前同步`:seconds<86400?`${Math.floor(seconds/3600)}小时前同步`:`${Math.floor(seconds/86400)}天前同步`;
}
const badges={ok:{label:'正常',tone:'ok'},stale:{label:'已过期',tone:'warn'},error:{label:'读取失败',tone:'danger'},login_required:{label:'需要登录',tone:'danger'},layout_changed:{label:'需要重新教学',tone:'warn'},offline:{label:'扩展离线',tone:'warn'}};
export function badge(state){return badges[state]??badges.error}
export function overallState(providers){return ['error','login_required','layout_changed','offline','stale'].find(state=>providers.some(p=>p.status===state))??(providers.length?'ok':'stale')}
