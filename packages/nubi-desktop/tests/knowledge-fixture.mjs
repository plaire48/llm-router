import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {stringify} from 'yaml';

export async function seedKnowledge(root,{sourcePath='app.txt'}={}){
  await mkdir(path.join(root,'.nubi'),{recursive:true});
  const ddl='CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, FOREIGN KEY (customer_id) REFERENCES customers(id));';
  await writeFile(path.join(root,'schema.sql'),ddl);
  const db=new DatabaseSync(path.join(root,'project.db'));db.exec(ddl);db.prepare('INSERT INTO customers VALUES (?,?)').run(1,'PRIVATE_ROW_MUST_NOT_BE_READ');db.close();
  const config={version:1,entities:[{id:'concept:customer',kind:'concept',label:'고객',aliases:['거래처','Customer']},{id:'source:customer',kind:'source',label:'고객 조회 코드',path:sourcePath},{id:'wiki:customer',kind:'wiki',label:'고객 Wiki',path:'openwiki/home.md'}],schemas:[{id:'design',label:'설계 스키마',path:'schema.sql',dialect:'SQLite',defaultSchema:'main'},{id:'live',label:'실제 SQLite',path:'project.db',mode:'sqlite',defaultSchema:'main',compareTo:'design'}],relations:[{from:'concept:customer',to:'table:live/main/customers',type:'represents'},{from:'source:customer',to:'table:live/main/customers',type:'reads'},{from:'wiki:customer',to:'concept:customer',type:'documents'}]};
  await writeFile(path.join(root,'.nubi/knowledge.yaml'),stringify(config));return config;
}

