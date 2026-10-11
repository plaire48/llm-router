import sql from 'node-sql-parser';

const name = value => typeof value === 'string' ? value : value?.expr?.value;
const validName = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/.test(value);

// A schema snapshot, never a migration interpreter or a SQL execution engine.
export function parseSchema(content, dialect) {
  const result = new sql.Parser().astify(content, {database:dialect});
  const statements = Array.isArray(result) ? result : [result];
  if (!statements.length || statements.length > 200 || statements.some(s => s.type !== 'create' || s.keyword !== 'table' || s.query_expr || s.as || !s.create_definitions)) throw new Error('schema_snapshot_required');
  return statements.map(statement => {
    const table = statement.table?.[0];
    if (statement.table?.length !== 1 || !validName(table?.table) || (table.db && !validName(table.db))) throw new Error('schema_unsupported');
    const definitions = statement.create_definitions;
    const primary = definitions.filter(d => d.constraint_type === 'primary key' || d.constraint_type === 'PRIMARY KEY').flatMap(d => (d.definition || []).map(c => name(c.column)));
    const columns = definitions.filter(d => d.resource === 'column').map(d => ({name:name(d.column.column),type:d.definition?.dataType || 'unknown',primary:!!d.primary_key || primary.includes(name(d.column.column))}));
    if (!columns.length || columns.length > 300 || columns.some(c => !validName(c.name)) || new Set(columns.map(c => c.name)).size !== columns.length) throw new Error('schema_unsupported');
    const references = definitions.filter(d => d.reference_definition).map(d => {
      const ref = d.reference_definition, target = ref.table?.[0];
      const from = d.resource === 'column' ? [name(d.column.column)] : (d.definition || []).map(c => name(c.column));
      const to = (ref.definition || []).map(c => name(c.column));
      if (ref.table?.length !== 1 || !validName(target?.table) || (target.db && !validName(target.db)) || !from.length || !to.length || from.length !== to.length || [...from,...to].some(c => !validName(c))) throw new Error('schema_unsupported');
      return {schema:target.db || null,table:target.table,from,to};
    });
    return {schema:table.db || null,name:table.table,columns,references};
  });
}
