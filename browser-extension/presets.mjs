// Official visible-page presets. Shared by Worker validation and the extension.
const entry=(id,type,name,url,metrics)=>({id,parser:`preset:${id}`,type,name,url,metrics});
const subscription={five_hour_percent:'percent',weekly_percent:'percent',credits:'credits'};
export const presets=[
 entry('chatgpt','chatgpt','ChatGPT','https://chatgpt.com/settings/usage?tab=overview',subscription),
 entry('codex','chatgpt','Codex','https://chatgpt.com/codex/settings/usage',subscription),
 entry('claude','claude','Claude','https://claude.ai/settings/usage',subscription),
 entry('gemini','gemini','Gemini / AI Studio','https://aistudio.google.com/usage',{requests:'requests',tokens:'tokens'}),
 entry('glm','glm','GLM 账户余额','https://bigmodel.cn/finance-center/finance/overview',{balance:'CNY'}),
 entry('glm-coding','glm','GLM Coding Plan','https://www.bigmodel.cn/coding-plan/personal/usage',subscription),
 entry('openrouter','openrouter','OpenRouter','https://openrouter.ai/settings/credits',{account_remaining:'USD'}),
 entry('deepseek','deepseek','DeepSeek','https://platform.deepseek.com/usage',{balance:'CNY'}),
 entry('moonshot','moonshot','Moonshot / Kimi','https://platform.kimi.com/console/account',{balance:'CNY'}),
 entry('moonshot-intl','moonshot','Moonshot / Kimi 国际','https://platform.kimi.ai/console/account',{balance:'USD'}),
 entry('grok','grok','Grok / xAI','https://console.x.ai/',{balance:'USD'}),
 entry('doubao','doubao','Doubao / Volcengine','https://console.volcengine.com/finance/fund/overview',{balance:'CNY'}),
 entry('qwen','qwen','Qwen / 阿里云余额','https://billing-cost.console.aliyun.com/home',{balance:'CNY'}),
 entry('bailian','qwen','百炼用量','https://bailian.console.aliyun.com/',{tokens:'tokens',requests:'requests'}),
 entry('siliconflow','siliconflow','SiliconFlow','https://cloud.siliconflow.cn/account/balance',{balance:'CNY'}),
 entry('siliconflow-intl','siliconflow','SiliconFlow 国际','https://cloud.siliconflow.com/account/balance',{balance:'USD'})
];
export function accountIndex(url){const u=new URL(url);const path=u.pathname.match(/\/u\/(\d+)(?:\/|$)/)?.[1],query=u.searchParams.get('authuser');if(query!==null&&!/^\d+$/.test(query))return null;if(path!==undefined&&query!==null&&path!==query)return null;return path??query??'0'}
export function matchPreset(url){
 let u;try{u=new URL(url)}catch{return null}if(u.protocol!=='https:'||u.username||u.password)return null;
 const path=u.pathname.replace(/\/u\/\d+(?=\/|$)/,'').replace(/\/$/,'')||'/';
 return presets.find(p=>{const e=new URL(p.url);return accountIndex(u.href)!==null&&[...u.searchParams.keys()].every(k=>e.searchParams.has(k)||k==='authuser'&&['aistudio.google.com','gemini.google.com'].includes(u.hostname))&&u.origin===e.origin&&path===(e.pathname.replace(/\/$/,'')||'/')&&u.hash===e.hash&&[...e.searchParams].every(([k,v])=>u.searchParams.get(k)===v)})??null;
}
export function samePage(actual,expected){
 try{const a=new URL(actual),e=new URL(expected);if(a.origin!==e.origin||a.hash!==e.hash)return false;
 if(a.hostname==='aistudio.google.com'||a.hostname==='gemini.google.com')return accountIndex(a.href)!==null&&accountIndex(a.href)===accountIndex(e.href)&&a.pathname.replace(/\/u\/\d+(?=\/|$)/,'')===e.pathname.replace(/\/u\/\d+(?=\/|$)/,'')&&[...e.searchParams].filter(([k])=>k!=='authuser').every(([k,v])=>a.searchParams.get(k)===v);
 return a.pathname===e.pathname&&a.search===e.search;
 }catch{return false}
}
export function sourceForPage(sources,url){const matches=sources.filter(s=>samePage(url,s.url));return matches.length===1?matches[0]:null}
