// ================= Firebase =================
const firebaseConfig = {
  apiKey: "AIzaSyB3zBW_WhVfNpX5uoJCq-6WysE5XKYKZt4",
  authDomain: "serranobrepedidos.firebaseapp.com",
  projectId: "serranobrepedidos",
  storageBucket: "serranobrepedidos.firebasestorage.app",
  messagingSenderId: "948939268023",
  appId: "1:948939268023:web:3f1f6c18f2c047c82b1232"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// login anônimo para cumprir regras que exigem request.auth != null
auth.signInAnonymously().catch(err => console.warn('anon sign-in:', err));
auth.onAuthStateChanged(u=>{
  if(u){
    const btn = document.getElementById('btnLogin');
    if (btn) { btn.textContent = 'Logado'; btn.disabled = true; }
  }
});

// ================= UI refs =================
const $ = (id)=>document.getElementById(id);
const tbody = $('tbody');
const resumo = $('resumo');
const pgInfo = $('pgInfo');
const tempo  = $('tempo');

const filtros = {
  dataIni: $('fDataIni'),
  dataFim: $('fDataFim'),
  horaIni: $('fHoraIni'),
  horaFim: $('fHoraFim'),
  cliente: $('fCliente'),
  status:  $('fStatus'),
  produto: $('fProduto'),
  vmin:    $('fVmin'),
  vmax:    $('fVmax'),
  vendedor:$('fVendedor'),
  pagamento: $('fPagamento'),
  entrega: $('fEntrega')
};

const state = {
  pageSize: 50,
  lastDoc: null,
  firstDoc: null,
  stack: [],
  currentPage: 1,
  lastQuerySnapMeta: null,
};

// ================= Auth “fachada” (opcional) =================
const USERS_FIXOS = [
  { user: 'Leo', pass: '1210', vendedor: 'Leo' },
  { user: 'serra nobre', pass: '0003', vendedor: 'Serra Nobre' },
];
async function loginDialog() {
  const u = prompt('Usuário: (Leo / serra nobre)');
  if(!u) return;
  const p = prompt('Senha: (1210 / 0003)');
  const ok = USERS_FIXOS.find(x => x.user.toLowerCase() === u.toLowerCase() && x.pass === p);
  if(!ok){ alert('Usuário/senha inválidos.'); return; }
  $('btnLogin').textContent = `Logado: ${ok.vendedor}`;
  $('btnLogin').disabled = true;
  sessionStorage.setItem('vendedorAtual', ok.vendedor);
}
$('btnLogin').addEventListener('click', loginDialog);
$('btnSair').addEventListener('click', ()=>{ sessionStorage.clear(); location.reload(); });

// ================= Helpers =================
function toBR(d){
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = d.getFullYear();
  return `${dd}-${mm}-${yy}`;
}
function parseDateInput(v){
  if(!v) return null;
  const [Y,M,D] = v.split('-').map(Number);
  return new Date(Y, (M-1), D, 0,0,0,0);
}
function timeInRange(hhmm, ini, fim){
  if(!hhmm) return true;
  const toMin = s => { const [h,m]=(s||'').split(':').map(Number); return h*60+(m||0); };
  const v = toMin(hhmm);
  const i = ini ? toMin(ini) : null;
  const f = fim ? toMin(fim) : null;
  if(i!=null && v<i) return false;
  if(f!=null && v>f) return false;
  return true;
}
function matchContains(s,needle){ return !needle || (s||'').toString().toLowerCase().includes(needle.toLowerCase()); }
function money(n){ return (n||0).toLocaleString('pt-BR',{minimumFractionDigits:2, maximumFractionDigits:2}); }
function sum(a){ return a.reduce((acc,n)=>acc+(n||0),0); }

// ================= Consulta principal =================
async function buscar(paginacao = 'reset'){
  const t0 = performance.now();
  const showError = (msg, link) => {
    const extra = link ? ` — <a href="${link}" target="_blank" rel="noopener">Criar índice</a>` : '';
    $('tbody').innerHTML = `<tr><td colspan="11" style="color:#b91c1c">Erro: ${msg}${extra}</td></tr>`;
    $('resumo').textContent = '0 pedidos';
    $('totais').innerHTML = '';
    $('tempo').textContent = '—';
  };

  try {
    tbody.innerHTML = '<tr><td colspan="11">Carregando…</td></tr>';

    let q = db.collection('pedidos');

    // Data de entrega (indexável)
    const di = parseDateInput(filtros.dataIni.value);
    const df = parseDateInput(filtros.dataFim.value);
    if (di && df) {
      const dfPlus = new Date(df.getTime() + 24*60*60*1000);
      q = q.where('dataEntrega', '>=', firebase.firestore.Timestamp.fromDate(di))
           .where('dataEntrega', '<',  firebase.firestore.Timestamp.fromDate(dfPlus));
    } else if (di) {
      q = q.where('dataEntrega', '>=', firebase.firestore.Timestamp.fromDate(di));
    } else if (df) {
      const dfPlus = new Date(df.getTime() + 24*60*60*1000);
      q = q.where('dataEntrega', '<', firebase.firestore.Timestamp.fromDate(dfPlus));
    }

    // Status (indexável)
    if (filtros.status.value) {
      q = q.where('status', '==', filtros.status.value);
    }

    // Ordenação + paginação (exige índice composto)
    q = q.orderBy('dataEntrega','desc').orderBy('createdAt','desc');

    if (paginacao === 'next' && state.lastDoc) {
      q = q.startAfter(state.lastDoc);
    } else if (paginacao === 'prev') {
      state.stack.pop();
      const prevCursor = state.stack[state.stack.length-1];
      if (prevCursor) {
        q = q.startAt(prevCursor);
        state.currentPage = Math.max(1, state.currentPage-1);
      } else {
        paginacao = 'reset';
        state.currentPage = 1;
      }
    } else {
      state.stack = [];
      state.currentPage = 1;
    }

    const snap = await q.limit(state.pageSize).get();
    const docs = snap.docs;

    if (docs.length){
      state.firstDoc = docs[0];
      state.lastDoc  = docs[docs.length-1];
      if (paginacao==='next' || paginacao==='reset'){
        state.stack.push(state.firstDoc);
        if (paginacao==='next') state.currentPage++;
      }
    }

    // Filtros não indexados
    let rows = docs.map(d => ({ id:d.id, ...d.data() }));
    rows = rows.filter(r => timeInRange(r.horaEntrega || '', filtros.horaIni.value, filtros.horaFim.value));
    rows = rows.filter(r => matchContains(r.cliente, filtros.cliente.value));
    rows = rows.filter(r => matchContains(r.vendedor, filtros.vendedor.value));
    if (filtros.pagamento.value) rows = rows.filter(r => (r.formaPagamento||'') === filtros.pagamento.value);
    if (filtros.entrega.value)   rows = rows.filter(r => (r.tipoEntrega||'') === filtros.entrega.value);
    if (filtros.produto.value){
      const needle = filtros.produto.value.toLowerCase();
      rows = rows.filter(r => (r.itens||[]).some(it => (it.produto||'').toLowerCase().includes(needle)));
    }
    const vmin = parseFloat(filtros.vmin.value || 'NaN');
    const vmax = parseFloat(filtros.vmax.value || 'NaN');
    rows = rows.filter(r => {
      const t = Number(r.total || 0);
      if(!Number.isNaN(vmin) && t < vmin) return false;
      if(!Number.isNaN(vmax) && t > vmax) return false;
      return true;
    });

    render(rows);

    const t1 = performance.now();
    tempo.textContent = `Consultado em ${(t1 - t0).toFixed(0)} ms`;
    pgInfo.textContent = `Página ${state.currentPage}`;
    state.lastQuerySnapMeta = { count: rows.length };
  } catch (err) {
    console.error(err);
    let link = '';
    if (typeof err.message === 'string') {
      const m = err.message.match(/https:\/\/console\.firebase\.google\.com\/[^\s)]+/);
      if (m) link = m[0];
    }
    if (err.code === 'failed-precondition') {
      showError('Esta consulta exige um índice composto.', link);
    } else if (err.code === 'permission-denied') {
      showError('Permissão negada. Habilite login anônimo e/ou ajuste as regras para leitura.');
    } else {
      showError(err.message || 'Erro ao consultar.');
    }
  }
}

function render(rows){
  if(!rows.length){
    tbody.innerHTML = '<tr><td colspan="11">Sem resultados para os filtros.</td></tr>';
    resumo.textContent = `0 pedidos`;
    $('totais').innerHTML = '';
    return;
  }

  const fmtRow = r=>{
    const d = r.dataEntrega?.toDate ? r.dataEntrega.toDate() : (r.dataEntrega || new Date());
    const dataBR = toBR(d);
    const hora = r.horaEntrega || '';
    const itensTxt = (r.itens||[]).map(it => `${it.produto} (${it.qtd} x R$ ${money(it.preco)})`).join(' | ');
    const total = money(r.total || sum((r.itens||[]).map(it => (it.qtd||0)*(it.preco||0))));
    const st = (r.status||'').replace(' ','_').toUpperCase();
    return `<tr>
      <td>${dataBR}</td>
      <td>${hora}</td>
      <td>${r.cliente||''}</td>
      <td>${itensTxt}</td>
      <td style="text-align:right">R$ ${total}</td>
      <td><span class="badge status-${st}">${r.status||''}</span></td>
      <td>${r.vendedor||''}</td>
      <td>${r.formaPagamento||''}</td>
      <td>${r.tipoEntrega||''}</td>
      <td>${r.obs||''}</td>
      <td style="font-size:12px;color:#64748b">${r.id}</td>
    </tr>`;
  };

  tbody.innerHTML = rows.map(fmtRow).join('');

  // KPIs
  const qtd = rows.length;
  const soma = sum(rows.map(r => Number(r.total || 0)));
  const abertos = rows.filter(r => (r.status||'').toUpperCase()==='ABERTO').length;
  const entregues = rows.filter(r => (r.status||'').toUpperCase()==='ENTREGUE').length;

  // Top 3 produtos
  const prodMap = new Map();
  for(const r of rows){
    for(const it of (r.itens||[])){
      const k = (it.produto||'').trim().toUpperCase();
      if(!k) continue;
      const cur = prodMap.get(k)||{qtd:0, total:0};
      cur.qtd += Number(it.qtd||0);
      cur.total += Number((it.qtd||0)*(it.preco||0));
      prodMap.set(k, cur);
    }
  }
  const top = [...prodMap.entries()].sort((a,b)=>b[1].total - a[1].total).slice(0,3);

  $('totais').innerHTML = `
    <div class="kpi"><div class="title">Pedidos (lista)</div><div class="val">${qtd}</div></div>
    <div class="kpi"><div class="title">Faturamento (lista)</div><div class="val">R$ ${money(soma)}</div></div>
    <div class="kpi"><div class="title">Entregues</div><div class="val">${entregues}</div></div>
    <div class="kpi"><div class="title">Abertos</div><div class="val">${abertos}</div></div>
  `;

  resumo.textContent = `${qtd} pedidos — Faturamento: R$ ${money(soma)} — Top: ${top.map(([p,v])=>`${p} (R$ ${money(v.total)})`).join(', ')}`;
}

// ================= Eventos UI =================
$('btnBuscar').addEventListener('click', ()=>buscar('reset'));
$('btnLimpar').addEventListener('click', ()=>{
  Object.values(filtros).forEach(i=>{ if(i.tagName==='SELECT') i.selectedIndex=0; else i.value=''; });
});
$('next').addEventListener('click', ()=>buscar('next'));
$('prev').addEventListener('click', ()=>buscar('prev'));

// Impressão A4
$('btnImprimir').addEventListener('click', ()=>window.print());
$('btnA4Landscape').addEventListener('click', ()=>{
  const style = document.createElement('style');
  style.setAttribute('id','landscape');
  style.textContent = `@page{ size: A4 landscape; margin: 12mm; }`;
  document.head.appendChild(style);
  window.print();
  setTimeout(()=>style.remove(), 500);
});

// CSV
$('btnCSV').addEventListener('click', ()=>{
  const rows = [...document.querySelectorAll('#tbl tr')].map(tr => [...tr.children].map(td => `"${(td.innerText||'').replaceAll('"','""')}"`).join(';'));
  const csv = rows.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `relatorio_pedidos_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
});

// Busca inicial automática ao abrir
document.addEventListener('DOMContentLoaded', ()=>buscar('reset'));
