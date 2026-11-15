import type { Unit } from './contracts';
export interface Preset {type: string; name: string; mode: 'api' | 'manual'; url: string; fields: {id: string; unit: Unit}[]; regions?: string[]}
const subscription = [{id: 'five_hour_percent', unit: 'percent'}, {id: 'weekly_percent', unit: 'percent'}, {id: 'credits', unit: 'credits'}] as const;
const balance = [{id: 'balance', unit: 'CNY'}, {id: 'credits', unit: 'credits'}] as const;
export const catalog: Preset[] = [
 {type:'deepseek',name:'DeepSeek',mode:'api',url:'https://platform.deepseek.com/usage',fields:[]},
 {type:'openrouter_key',name:'OpenRouter · Key',mode:'api',url:'https://openrouter.ai/settings/keys',fields:[]},
 {type:'openrouter_credits',name:'OpenRouter · Account',mode:'api',url:'https://openrouter.ai/settings/credits',fields:[]},
 {type:'moonshot',name:'Moonshot Kimi',mode:'api',url:'https://platform.moonshot.cn/console/account',fields:[],regions:['cn','ai']},
 {type:'siliconflow',name:'SiliconFlow',mode:'manual',url:'https://cloud.siliconflow.cn/account/balance',fields:[{id:'totalBalance',unit:'CNY'},{id:'chargeBalance',unit:'CNY'},{id:'balance',unit:'CNY'}],regions:['cn','com']},
 ...[
 ['chatgpt','ChatGPT / Codex','https://chatgpt.com/settings/usage?tab=overview'],
 ['claude','Claude','https://claude.ai/settings/usage'],
 ['gemini','Gemini / Google AI Pro','https://gemini.google.com/'],
 ['grok','Grok','https://grok.com/'],
 ['glm','GLM / Coding Plan','https://bigmodel.cn/usercenter/financial/overview'],
 ['doubao','Doubao / Volcengine','https://console.volcengine.com/finance/overview/'],
 ['qwen','Qwen / Bailian','https://bailian.console.aliyun.com/'],
 ['custom','Custom','https://example.com/']
 ].map(([type,name,url]) => ({type,name,url,mode:'manual' as const,fields: (['doubao','qwen'].includes(type) ? [...balance] : ['glm','custom'].includes(type) ? [...subscription,{id:'balance',unit:'CNY' as const},...(type==='custom'?[{id:'tokens',unit:'tokens' as const},{id:'requests',unit:'requests' as const}]:[])] : [...subscription])}))
];
export function preset(type: string): Preset {const p = catalog.find(p=>p.type===type); if (!p) throw new Error('invalid_provider'); return p}
export function officialUrl(type: string, region: string): string {
 if(type==='moonshot' && region==='ai') return 'https://platform.moonshot.ai/console/account';
 if(type==='siliconflow' && region==='com') return 'https://cloud.siliconflow.com/account/balance';
 return preset(type).url;
}

export function fieldsFor(type: string,region: string) {
 return preset(type).fields.map(f=>({...f,unit:type==='siliconflow'&&region==='com'?'USD' as const:f.unit}));
}
