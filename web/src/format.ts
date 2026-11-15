import type { QuotaItem } from '../../shared/contracts';
export function amount(item: QuotaItem,locale: string): string {
 if(item.amount===null)return '—';
 const n=Number(item.amount);
 if(item.unit==='percent')return `${new Intl.NumberFormat(locale,{maximumFractionDigits:1}).format(n)}%`;
 if(item.unit==='CNY'||item.unit==='USD')return new Intl.NumberFormat(locale,{style:'currency',currency:item.unit,maximumFractionDigits:4}).format(n);
 return new Intl.NumberFormat(locale,{maximumFractionDigits:4}).format(n);
}
export function duration(ms: number): string {
 const minutes=Math.max(0,Math.ceil(ms/60000));const d=Math.floor(minutes/1440),h=Math.floor(minutes%1440/60),m=minutes%60;
 return `${d?`${d}d `:''}${h?`${h}h `:''}${m}m`;
}
export function timestamp(value: string | number,locale: string,timeZone='Asia/Taipei'): string {
 return new Intl.DateTimeFormat(locale,{timeZone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
}
