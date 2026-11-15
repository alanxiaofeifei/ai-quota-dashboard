// Real SQLite executes the production SQL. Only the D1 transport is replaced.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function database(): D1Database {
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../../migrations/0001_init.sql',import.meta.url),'utf8'));
 const make=(sql: string,values: SQLInputValue[]=[]): D1PreparedStatement=>{
  const statement=()=>sqlite.prepare(sql);
  const run=()=>{const info=statement().run(...values);return {success:true,results:[],meta:{changes:Number(info.changes),last_row_id:Number(info.lastInsertRowid),duration:0,rows_read:0,rows_written:0,size_after:0,changed_db:true}}};
  return {
   bind(...v:unknown[]){return make(sql,v as SQLInputValue[])},
   async first<T>(column?:string):Promise<T|null>{const row=statement().get(...values);return row?(column?row[column]:row) as T:null},
   async all<T>():Promise<D1Result<T>> {return {...runMetadata(),results:statement().all(...values) as T[]}},
   async run<T>():Promise<D1Result<T>> {return run() as D1Result<T>},
   async raw<T>():Promise<T[]> {return statement().all(...values).map(Object.values) as T[]}
  } as D1PreparedStatement;
 };
 const runMetadata=()=>({success:true as const,meta:{changes:0,last_row_id:0,duration:0,rows_read:0,rows_written:0,size_after:0,changed_db:false}});
 return {
  prepare:make,
  async batch<T>(statements:D1PreparedStatement[]):Promise<D1Result<T>[]> {sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run<T>());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}},
  async exec(sql:string){sqlite.exec(sql);return {count:1,duration:0}}
 } as D1Database;
}
