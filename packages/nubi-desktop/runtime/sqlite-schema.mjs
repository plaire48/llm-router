import {DatabaseSync} from 'node:sqlite';

// Fixed metadata queries only: no arbitrary SQL, row sampling, defaults, views,
// triggers, stored credentials or extensions are read into the model context.
export function readSQLiteSchema(filename) {
  const db=new DatabaseSync(filename,{readOnly:true,allowExtension:false,enableDoubleQuotedStringLiterals:false,timeout:1000});
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN');
    const listed=db.prepare("SELECT name, type FROM pragma_table_list WHERE schema='main' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 201").all();
    if(listed.length>200)throw new Error('schema_limit');
    const tables=listed.filter(t=>t.type==='table').map(table=>{
      const rows=db.prepare('SELECT name,type,pk,hidden FROM pragma_table_xinfo(?) ORDER BY cid LIMIT 301').all(table.name);
      if(rows.length>300)throw new Error('schema_limit');
      const columns=rows.map(c=>({name:c.name,type:c.type||'untyped',primary:c.pk>0,primaryOrder:c.pk,generated:c.hidden>0}));
      const groups=new Map();
      for(const ref of db.prepare('SELECT id, seq, "table" AS target, "from" AS source, "to" AS targetColumn FROM pragma_foreign_key_list(?) ORDER BY id, seq').all(table.name)){
        if(!groups.has(ref.id))groups.set(ref.id,{schema:'main',table:ref.target,from:[],to:[]});
        const group=groups.get(ref.id);group.from.push(ref.source);group.to.push(ref.targetColumn);
      }
      return {schema:'main',name:table.name,columns,references:[...groups.values()]};
    });
    const byName=new Map(tables.map(t=>[t.name,t]));
    for(const table of tables)for(const ref of table.references){
      if(ref.to.every(c=>c===null))ref.to=(byName.get(ref.table)?.columns||[]).filter(c=>c.primary).sort((a,b)=>a.primaryOrder-b.primaryOrder).map(c=>c.name);
    }
    db.exec('ROLLBACK');
    return {tables,excluded:listed.filter(t=>t.type!=='table').length};
  } finally {db.close();}
}
