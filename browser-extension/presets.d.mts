export interface PagePreset {id:string;parser:`preset:${string}`;type:string;name:string;url:string;metrics:Record<string,string>}
export const presets:PagePreset[];
export function matchPreset(url:string):PagePreset|null;
export function accountIndex(url:string):string|null;
export function samePage(actual:string,expected:string):boolean;
export function sourceForPage<T extends {url:string}>(sources:T[],url:string):T|null;
