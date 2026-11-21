import type { Unit } from './contracts';
export interface Preset {type:string;name:string;mode:'api'|'manual';url:string;usageUrl:string;keyUrl?:string;docsUrl:string;extraUsageUrl?:string;fields:{id:string;unit:Unit}[];regions?:string[]}
const subscription = [{id:'five_hour_percent',unit:'percent'},{id:'weekly_percent',unit:'percent'},{id:'credits',unit:'credits'}] as const;
const balance = [{id:'balance',unit:'CNY'},{id:'credits',unit:'credits'}] as const;
const entries: Omit<Preset,'url'>[] = [
 {type:'deepseek',name:'DeepSeek',mode:'api',usageUrl:'https://platform.deepseek.com/usage',keyUrl:'https://platform.deepseek.com/api_keys',docsUrl:'https://api-docs.deepseek.com/api/get-user-balance',fields:[]},
 {type:'openrouter',name:'OpenRouter',mode:'api',usageUrl:'https://openrouter.ai/settings/credits',keyUrl:'https://openrouter.ai/settings/management-keys',docsUrl:'https://openrouter.ai/docs/api/api-reference/credits/get-credits',fields:[]},
 {type:'moonshot',name:'Moonshot / Kimi',mode:'api',usageUrl:'https://platform.kimi.com/console/account',keyUrl:'https://platform.kimi.com/console/api-keys',docsUrl:'https://platform.kimi.com/docs/api/balance',fields:[],regions:['cn','ai']},
 {type:'siliconflow',name:'SiliconFlow',mode:'manual',usageUrl:'https://cloud.siliconflow.cn/account/balance',keyUrl:'https://cloud.siliconflow.cn/account/ak',docsUrl:'https://docs.siliconflow.cn/docs/release-notes/overview',fields:[{id:'totalBalance',unit:'CNY'},{id:'chargeBalance',unit:'CNY'},{id:'balance',unit:'CNY'}],regions:['cn','com']},
 {type:'chatgpt',name:'ChatGPT / Codex',mode:'manual',usageUrl:'https://chatgpt.com/settings/usage?tab=overview',extraUsageUrl:'https://chatgpt.com/codex/settings/usage',docsUrl:'https://help.openai.com/en/articles/20001625-understanding-chatgpt-and-codex-usage-limits',fields:[...subscription]},
 {type:'claude',name:'Claude',mode:'manual',usageUrl:'https://claude.ai/settings/usage',docsUrl:'https://support.claude.com/en/articles/11647753',fields:[...subscription]},
 {type:'gemini',name:'Gemini / Google AI Pro',mode:'manual',usageUrl:'https://aistudio.google.com/usage',keyUrl:'https://aistudio.google.com/apikey',docsUrl:'https://support.google.com/gemini/answer/16275805',fields:[{id:'requests',unit:'requests'},{id:'tokens',unit:'tokens'}]},
 {type:'grok',name:'Grok / xAI',mode:'manual',usageUrl:'https://console.x.ai/',keyUrl:'https://console.x.ai/',docsUrl:'https://docs.x.ai/overview',fields:[...subscription]},
 {type:'glm',name:'GLM / Coding Plan',mode:'manual',usageUrl:'https://bigmodel.cn/finance-center/finance/overview',extraUsageUrl:'https://www.bigmodel.cn/coding-plan/personal/usage',keyUrl:'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',docsUrl:'https://docs.bigmodel.cn/cn/coding-plan/overview',fields:[...subscription,{id:'balance',unit:'CNY'}]},
 {type:'doubao',name:'Doubao / Volcengine',mode:'manual',usageUrl:'https://console.volcengine.com/finance/fund/overview',keyUrl:'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',docsUrl:'https://www.volcengine.com/docs/82379/1099475',fields:[...balance]},
 {type:'qwen',name:'Qwen / Bailian',mode:'manual',usageUrl:'https://billing-cost.console.aliyun.com/home',extraUsageUrl:'https://bailian.console.aliyun.com/',keyUrl:'https://bailian.console.aliyun.com/?tab=model#/api-key',docsUrl:'https://help.aliyun.com/zh/model-studio/model-pricing',fields:[...balance]},
 {type:'custom',name:'Custom',mode:'manual',usageUrl:'https://example.com/',docsUrl:'https://example.com/',fields:[...subscription,{id:'balance',unit:'CNY'},{id:'tokens',unit:'tokens'},{id:'requests',unit:'requests'}]}
];
export const catalog:Preset[]=entries.map(p=>({...p,url:p.usageUrl}));
export function preset(type:string):Preset {const p=catalog.find(p=>p.type===type);if(!p)throw new Error('invalid_provider');return p}
export function providerLinks(type:string,region:string) {
 const p=preset(type);
 if(type==='moonshot'&&region==='ai')return {...p,usageUrl:'https://platform.kimi.ai/console/account',keyUrl:'https://platform.kimi.ai/console/api-keys',docsUrl:'https://platform.kimi.ai/docs/api/balance'};
 if(type==='siliconflow'&&region==='com')return {...p,usageUrl:'https://cloud.siliconflow.com/account/balance',keyUrl:'https://cloud.siliconflow.com/account/ak'};
 return p;
}
export function officialUrl(type:string,region:string){return providerLinks(type,region).usageUrl}
export function fieldsFor(type:string,region:string){return preset(type).fields.map(f=>({...f,unit:type==='siliconflow'&&region==='com'?'USD' as const:f.unit}))}
export function keyGuidance(type:string,en=false) {
 if(type==='deepseek')return en?'Any API Key from this account works: /user/balance returns the current account balance. Create a dedicated quota-dashboard key for easy revocation.':'任意一个本账户的 API Key 都可以（余额是账户级，官方 /user/balance 返回账户当前余额）；建议单独建一个名为 quota-dashboard 的 Key 便于吊销。';
 if(type==='moonshot')return en?'Any API Key from this account works; the balance is account-wide. Create a quota-dashboard key for revocation. China and international keys are not interchangeable: choose the correct region.':'任意一个本账户的 API Key 都可以，余额是账户级；建议单独建 quota-dashboard Key 便于吊销。国内站与国际站 Key 不通用，请选对区域。';
 if(type==='openrouter')return en?'Account balance requires a Management Key created in settings/management-keys. /credits accepts only management keys. A normal key shows only this key’s spending limit, never the account balance.':'账户余额必须用 Management Key（管理密钥，在 settings/management-keys 创建；官方 /credits 只接受管理密钥）；普通 Key 只能看到「此 Key 的消费上限」，看不到账户余额。';
 return en?'Open the official page below. Read the displayed remaining/used percentage, reset time, credits or account balance, keeping each unit separate. Gemini/Grok apps may not show usage: use their API console link where applicable. Use a built-in preset first, and teach a displayed value only as a fallback.':'打开下方官方页面，读取页面显示的剩余／已用百分比、重置时间、独立 credits 或账户余额，各单位分别记录。Gemini/Grok 应用可能不显示额度，请按账户使用其 API 控制台链接。先用扩展内置预设「一键获取当前页数据」，读不到时再教学单个数值。';
}
