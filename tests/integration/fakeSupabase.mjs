// Fake in-memory do cliente Supabase para os testes de importação.
//
// Objetivo: exercitar o fluxo completo de importação (criar avaliação → enviar
// arquivo → gravar registros/períodos/indicadores → publicar → detectar hash
// duplicado → marcar erro) SEM tocar o projeto real. Assim os testes de
// integração nunca deixam avaliações, registros ou arquivos permanentes.
//
// Emula apenas o subconjunto da API PostgREST/Storage usado pelos services.

export function createFakeSupabase(){
  const tables = new Map();          // nome da tabela -> linhas[]
  const files  = new Map();          // path no bucket -> Uint8Array
  const flags  = { uploadError: null };
  const getTable = name => { if(!tables.has(name)) tables.set(name, []); return tables.get(name); };

  function builder(table){
    const s = { op:'select', filters:[], patch:null, rows:null, single:false, maybe:false, offset:0, limit:null, order:[] };
    const match = r => s.filters.every(f => f(r));
    const api = {
      select(){ return api; },
      insert(rows){ s.op='insert'; s.rows = Array.isArray(rows)?rows:[rows]; return api; },
      update(patch){ s.op='update'; s.patch = patch; return api; },
      delete(){ s.op='delete'; return api; },
      eq(col,val){ s.filters.push(r => r[col] === val); return api; },
      in(col,vals){ s.filters.push(r => vals.includes(r[col])); return api; },
      order(col,opts){ s.order.push({ col, desc: opts?.ascending === false }); return api; },
      range(from,to){ s.offset = from; s.limit = to - from + 1; return api; },
      limit(n){ s.limit = n; return api; },
      single(){ s.single = true; return api; },
      maybeSingle(){ s.maybe = true; s.single = true; return api; },
      then(resolved,rejected){ return exec().then(resolved,rejected); },
      catch(fn){ return exec().catch(fn); }
    };
    async function exec(){
      const rows = getTable(table);
      if(s.op === 'insert'){
        const copies = s.rows.map(r => ({ ...r }));
        rows.push(...copies);
        return { data: s.single ? (copies[0] ?? null) : copies, error:null };
      }
      if(s.op === 'update'){
        const matched = rows.filter(match);
        for(const r of matched) Object.assign(r, s.patch);
        return { data: s.single ? (matched[0] ?? null) : matched.map(r => ({ ...r })), error:null };
      }
      if(s.op === 'delete'){
        // RLS do projeto: o papel `anon` NÃO tem DELETE — emula o erro real.
        return { data:null, error:{ message:`permission denied for table ${table}`, code:'42501' } };
      }
      let out = rows.filter(match);
      for(const { col, desc } of [...s.order].reverse()){
        out = out.slice().sort((a,b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (desc ? -1 : 1));
      }
      if(s.offset) out = out.slice(s.offset);
      if(s.limit != null) out = out.slice(0, s.limit);
      return { data: s.single ? (out[0] ?? null) : out.map(r => ({ ...r })), error:null };
    }
    return api;
  }

  const storage = {
    from(bucket){
      return {
        async upload(path, data, opts){
          if(flags.uploadError) return { data:null, error:{ message: flags.uploadError, code:'500' } };
          if(files.has(path) && !opts?.upsert) return { data:null, error:{ message:'The resource already exists', code:'409' } };
          files.set(path, data instanceof Uint8Array ? data : new Uint8Array(data));
          return { data:{ path, bucket }, error:null };
        },
        async list(folder){
          const prefix = folder ? String(folder).replace(/\/?$/,'/') : '';
          const names = [...files.keys()].filter(p => p.startsWith(prefix)).map(p => ({ name: p.slice(prefix.length) }));
          return { data:names, error:null };
        },
        async download(path){
          const bytes = files.get(path);
          if(!bytes) return { data:null, error:{ message:'Object not found', code:'404' } };
          return { data:{ arrayBuffer: async() => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error:null };
        },
        async remove(){
          // RLS: `anon` não tem DELETE no Storage — remove é no-op sem erro.
          return { data:[], error:null };
        }
      };
    }
  };

  return {
    from: builder,
    storage,
    __tables: tables,
    __files: files,
    __setUploadError: msg => { flags.uploadError = msg; },
    __rowsOf: name => getTable(name)
  };
}
