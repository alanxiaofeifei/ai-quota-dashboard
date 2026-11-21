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

export const reasonText=reason=>({permission_required:'需授权：点获取当前页并允许网站权限',login_required:'需登录：打开官方页重新登录',layout_changed:'页面改版：请核对页面或重新教学',timeout:'超时：打开页面后重试',no_data:'此页没有可识别的额度数字；可用教学后备',account_mismatch:'账户地址不匹配，请核对 authuser 或 /u/N/',disabled:'未启用：在设置中启用来源',management_key_required:'账户余额需要 Management Key；也可从官方 credits 页读取',network:'网络或上传失败：请重试',not_synced:'尚未同步：打开官方页并授权读取',pending:'等待同步',reading:'正在读取',ok:'同步成功'})[reason]??'读取失败，请重试';
