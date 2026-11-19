/*
 * AgroStore — camada de dados compartilhada entre o site, o chatbot e o painel admin.
 *
 * Dois modos, escolhidos automaticamente pelo js/config.js:
 *  - "supabase": dados e agendamentos ficam no Supabase (sincroniza entre aparelhos).
 *  - "local":    modo demonstração, tudo no localStorage deste navegador.
 *
 * API pública (todas retornam Promise):
 *   carregarDados()               dados do site = dados.js sobrescrito pelo que o admin salvou
 *   salvarAgendamento(pedido)     usado pelo chatbot — resolve { id, modo } ou rejeita com Error
 *   --- painel admin ---
 *   entrar(email, senha) · sair() · usuarioAtual()
 *   salvarDados(dados) · listarAgendamentos() · atualizarStatus(id, status)
 *   excluirAgendamento(id) · enviarImagem(arquivo) → url
 *   --- contatos, visitas e lembretes ---
 *   registrarContato({id, tipo, nome, telefone, pet})   chatbot, assim que tem nome + WhatsApp
 *   registrarVisita()                                    site, 1 por sessão do navegador
 *   listarContatos() · marcarRetomada(id) · excluirContato(id)            painel
 *   listarLembretes() · registrarLembrete(telefone, "enviado"|"pulado")   painel
 *   resumoVisitas() → { hoje, semana, mes: { acessos, visitantes } }     painel
 *   obterModo() → "supabase" | "local"
 */
(function () {
  "use strict";

  // Só essas chaves de DADOS_AGROCAMPO são editáveis pelo painel. O resto
  // (textos, nome, etc.) continua vindo sempre do dados.js.
  const CHAVES_EDITAVEIS = [
    "whatsapp",
    "endereco",
    "horario",
    "instagram",
    "email",
    "veterinario",
    "servicos",
    "resultados",
    "produtos",
  ];
  const TIPOS = ["banho-tosa", "veterinario", "medicamento"];
  const STATUS = ["novo", "confirmado", "concluido", "cancelado"];

  const LS_DADOS = "agro.dados"; // modo local: o que o admin salvou
  const LS_CACHE = "agro.cache"; // modo supabase: última cópia boa (se a rede falhar)
  const LS_PEDIDOS = "agro.agendamentos";
  const LS_SESSAO = "agro.sessao";
  const LS_CONTATOS = "agro.contatos"; // modo local: quem deu nome + WhatsApp no chat
  const LS_VISITAS = "agro.visitas"; // modo local: acessos ao site (só deste navegador)
  const LS_LEMBRETES = "agro.lembretes"; // modo local: lembretes de 30 dias já enviados
  const LS_VISITANTE = "agro.visitante"; // id anônimo deste navegador, pra contar visitantes únicos
  const SS_VISITA = "agro.visita-contada"; // 1 acesso por sessão do navegador (recarregar não conta)

  // ---------- utilidades ----------

  function clonar(obj) {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj));
  }

  function lerLS(chave) {
    try {
      const txt = localStorage.getItem(chave);
      return txt ? JSON.parse(txt) : null;
    } catch (e) {
      return null;
    }
  }

  function gravarLS(chave, valor) {
    try {
      if (valor == null) localStorage.removeItem(chave);
      else localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch (e) {
      return false;
    }
  }

  function gerarId() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function comTempoLimite(promessa, ms) {
    return new Promise(function (resolve, reject) {
      const t = setTimeout(function () {
        reject(new Error("Tempo esgotado"));
      }, ms);
      promessa.then(
        function (v) { clearTimeout(t); resolve(v); },
        function (e) { clearTimeout(t); reject(e); }
      );
    });
  }

  function padrao() {
    // DADOS_AGROCAMPO é um `const` global de dados.js (não fica em window)
    return clonar(typeof DADOS_AGROCAMPO !== "undefined" ? DADOS_AGROCAMPO : {}) || {};
  }

  function mesclar(base, salvo) {
    const r = clonar(base);
    if (!salvo || typeof salvo !== "object") return r;
    CHAVES_EDITAVEIS.forEach(function (k) {
      if (salvo[k] === undefined || salvo[k] === null) return;
      if (k === "veterinario") r.veterinario = Object.assign({}, r.veterinario, salvo.veterinario);
      else r[k] = salvo[k];
    });
    return r;
  }

  function soEditaveis(dados) {
    const r = {};
    CHAVES_EDITAVEIS.forEach(function (k) {
      if (dados && dados[k] !== undefined) r[k] = clonar(dados[k]);
    });
    return r;
  }

  // ---------- configuração ----------

  const scriptAtual = document.currentScript;
  const pastaJs = scriptAtual && scriptAtual.src ? scriptAtual.src.replace(/[^/]*$/, "") : "js/";
  let promessaConfig = null;

  // Carrega js/config.js sozinho, pra o site só precisar incluir store.js.
  function obterConfig() {
    if (promessaConfig) return promessaConfig;
    promessaConfig = new Promise(function (resolve) {
      if (window.AGRO_CONFIG) return resolve(window.AGRO_CONFIG);
      const s = document.createElement("script");
      s.src = pastaJs + "config.js";
      s.onload = function () { resolve(window.AGRO_CONFIG || {}); };
      s.onerror = function () { resolve({}); };
      document.head.appendChild(s);
    });
    return promessaConfig;
  }

  function supabaseLigado(c) {
    return (
      /^https:\/\/.+/.test(c.supabaseUrl || "") &&
      !!c.supabaseAnonKey &&
      !/COLE_AQUI/.test(c.supabaseAnonKey)
    );
  }

  async function obterModo() {
    return supabaseLigado(await obterConfig()) ? "supabase" : "local";
  }

  // ---------- Supabase via REST (sem biblioteca externa) ----------

  async function urlBase() {
    return (await obterConfig()).supabaseUrl.replace(/\/+$/, "");
  }

  async function lerErro(resp) {
    let msg = "";
    try {
      const j = await resp.json();
      msg = j.message || j.error_description || j.msg || j.error || "";
    } catch (e) { /* sem corpo */ }
    const erro = new Error(msg || "Erro " + resp.status);
    erro.status = resp.status;
    return erro;
  }

  async function sb(caminho, opcoes, comSessao) {
    const c = await obterConfig();
    let token = c.supabaseAnonKey;
    if (comSessao) {
      const s = await sessaoValida();
      if (!s) {
        const e = new Error("Sua sessão expirou. Entre de novo.");
        e.sessao = true;
        throw e;
      }
      token = s.access_token;
    }
    opcoes = opcoes || {};
    const headers = Object.assign(
      { apikey: c.supabaseAnonKey, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      opcoes.headers
    );
    const resp = await fetch((await urlBase()) + caminho, Object.assign({}, opcoes, { headers: headers }));
    if (!resp.ok) {
      const e = await lerErro(resp);
      if (resp.status === 401 && comSessao) { gravarLS(LS_SESSAO, null); e.sessao = true; }
      throw e;
    }
    const txt = await resp.text();
    return txt ? JSON.parse(txt) : null;
  }

  function traduzirErroAuth(j) {
    const m = (j && (j.error_description || j.msg || j.message || j.error)) || "";
    if (/invalid login|invalid_grant|credentials/i.test(m)) return "E-mail ou senha incorretos.";
    if (/not confirmed/i.test(m)) return "Esse e-mail ainda não foi confirmado no Supabase.";
    return m || "Não foi possível entrar. Tente de novo.";
  }

  async function sbAuth(grant, corpo) {
    const c = await obterConfig();
    const resp = await fetch((await urlBase()) + "/auth/v1/token?grant_type=" + grant, {
      method: "POST",
      headers: { apikey: c.supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const j = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw new Error(traduzirErroAuth(j));
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      email: j.user && j.user.email,
    };
  }

  let renovando = null; // evita duas renovações de token ao mesmo tempo

  async function sessaoValida() {
    const modo = await obterModo();
    const s = lerLS(LS_SESSAO);
    if (!s) return null;
    if (modo === "local") return s.local ? s : null;
    if (s.local || !s.refresh_token) return null;
    if (s.expires_at * 1000 > Date.now() + 60 * 1000) return s;
    if (!renovando) {
      renovando = sbAuth("refresh_token", { refresh_token: s.refresh_token })
        .then(function (nova) { gravarLS(LS_SESSAO, nova); return nova; })
        .catch(function () { gravarLS(LS_SESSAO, null); return null; })
        .finally(function () { renovando = null; });
    }
    return renovando;
  }

  // ---------- dados do site ----------

  async function carregarDados() {
    const base = padrao();
    if ((await obterModo()) === "local") return mesclar(base, lerLS(LS_DADOS));
    try {
      const linhas = await comTempoLimite(
        sb("/rest/v1/site_config?id=eq.principal&select=dados"),
        5000
      );
      const salvo = linhas && linhas[0] ? linhas[0].dados : null;
      gravarLS(LS_CACHE, salvo);
      return mesclar(base, salvo);
    } catch (e) {
      // O site nunca pode ficar em branco: usa a última cópia boa ou o dados.js.
      console.warn("AgroStore: não consegui buscar os dados no Supabase.", e);
      return mesclar(base, lerLS(LS_CACHE));
    }
  }

  async function salvarDados(dados) {
    const editaveis = soEditaveis(dados);
    if ((await obterModo()) === "local") {
      if (!gravarLS(LS_DADOS, editaveis)) {
        throw new Error("O navegador ficou sem espaço . Use fotos menores ou ligue o Supabase.");
      }
      return true;
    }
    await sb(
      "/rest/v1/site_config",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: "principal", dados: editaveis, atualizado_em: new Date().toISOString() }),
      },
      true
    );
    gravarLS(LS_CACHE, editaveis);
    return true;
  }

  // ---------- agendamentos / pedidos ----------

  function texto(v, max) {
    if (v === null || v === undefined) return "";
    return String(v).trim().slice(0, max || 300);
  }

  function itemComoTexto(i) {
    if (i === null || i === undefined) return "";
    if (typeof i !== "object") return texto(i, 200);
    const nome = i.nome || i.produto || i.descricao || i.item || "";
    const qtd = i.quantidade || i.qtd || "";
    return texto(nome ? nome + (qtd ? " × " + qtd : "") : JSON.stringify(i), 200);
  }

  function normalizarPedido(p) {
    p = p && typeof p === "object" ? p : {};
    const tutor = p.tutor || {};
    const pet = p.pet || {};
    let itens = [];
    if (Array.isArray(p.itens)) itens = p.itens.slice(0, 30).map(itemComoTexto).filter(Boolean);
    else if (p.itens) itens = [texto(p.itens, 500)];
    return {
      tipo: TIPOS.indexOf(p.tipo) >= 0 ? p.tipo : texto(p.tipo, 40) || "outro",
      tutor: { nome: texto(tutor.nome, 120), telefone: texto(tutor.telefone, 40) },
      pet: { nome: texto(pet.nome, 80), especie: texto(pet.especie, 60), porte: texto(pet.porte, 40) },
      servico: texto(p.servico, 200),
      data: texto(p.data, 40),
      periodo: texto(p.periodo, 40),
      itens: itens,
      observacoes: texto(p.observacoes, 1000),
      origem: texto(p.origem, 30), // ex.: "chat" (assistente) ou "formulario"
      chatId: texto(p.chatId, 60), // liga o pedido ao contato salvo no meio da conversa
      criadoEm: texto(p.criadoEm, 40) || new Date().toISOString(),
    };
  }

  async function salvarAgendamento(pedido) {
    const p = normalizarPedido(pedido);
    const id = gerarId();
    if ((await obterModo()) === "local") {
      const lista = lerLS(LS_PEDIDOS) || [];
      lista.unshift({ id: id, status: "novo", recebidoEm: new Date().toISOString(), pedido: p });
      if (!gravarLS(LS_PEDIDOS, lista.slice(0, 300))) throw new Error("Não foi possível salvar o pedido.");
      return { id: id, modo: "local" };
    }
    await sb("/rest/v1/agendamentos", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ id: id, tipo: p.tipo, status: "novo", pedido: p }),
    });
    return { id: id, modo: "supabase" };
  }

  function linhaParaPedido(l) {
    // Formato devolvido ao admin: o pedido original + id, status e recebidoEm
    return Object.assign({}, l.pedido, {
      id: l.id,
      status: l.status,
      recebidoEm: l.recebidoEm || l.criado_em,
    });
  }

  async function listarAgendamentos() {
    if ((await obterModo()) === "local") return (lerLS(LS_PEDIDOS) || []).map(linhaParaPedido);
    const linhas = await sb(
      "/rest/v1/agendamentos?select=id,status,criado_em,pedido&order=criado_em.desc&limit=300",
      {},
      true
    );
    return (linhas || []).map(linhaParaPedido);
  }

  async function atualizarStatus(id, status) {
    if (STATUS.indexOf(status) < 0) throw new Error("Status inválido: " + status);
    if ((await obterModo()) === "local") {
      const lista = lerLS(LS_PEDIDOS) || [];
      lista.forEach(function (l) { if (l.id === id) l.status = status; });
      gravarLS(LS_PEDIDOS, lista);
      return true;
    }
    await sb(
      "/rest/v1/agendamentos?id=eq." + encodeURIComponent(id),
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: status }) },
      true
    );
    return true;
  }

  async function excluirAgendamento(id) {
    if ((await obterModo()) === "local") {
      gravarLS(LS_PEDIDOS, (lerLS(LS_PEDIDOS) || []).filter(function (l) { return l.id !== id; }));
      return true;
    }
    await sb("/rest/v1/agendamentos?id=eq." + encodeURIComponent(id), { method: "DELETE" }, true);
    return true;
  }

  // ---------- contatos do chat (quem deu nome + WhatsApp, concluindo ou não) ----------

  // Chamado pelo chatbot assim que tem nome e telefone. `id` é o id da conversa
  // (o mesmo vai no pedido como chatId), então salvar duas vezes não duplica.
  async function registrarContato(contato) {
    const c = contato && typeof contato === "object" ? contato : {};
    const linha = {
      id: texto(c.id, 60) || gerarId(),
      tipo: texto(c.tipo, 40),
      nome: texto(c.nome, 120),
      telefone: texto(c.telefone, 40).replace(/\D/g, ""),
      pet: texto(c.pet, 80),
    };
    if (!linha.nome || linha.telefone.length < 10) return { id: linha.id, ignorado: true };

    if ((await obterModo()) === "local") {
      const lista = lerLS(LS_CONTATOS) || [];
      if (!lista.some((l) => l.id === linha.id)) {
        lista.unshift(Object.assign({ criadoEm: new Date().toISOString(), retomadaEm: null }, linha));
        gravarLS(LS_CONTATOS, lista.slice(0, 500));
      }
      return { id: linha.id, modo: "local" };
    }
    await sb("/rest/v1/contatos", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(linha),
    });
    return { id: linha.id, modo: "supabase" };
  }

  async function listarContatos() {
    if ((await obterModo()) === "local") return lerLS(LS_CONTATOS) || [];
    const linhas = await sb(
      "/rest/v1/contatos?select=id,criado_em,tipo,nome,telefone,pet,retomada_em&order=criado_em.desc&limit=500",
      {},
      true
    );
    return (linhas || []).map((l) => ({
      id: l.id, criadoEm: l.criado_em, tipo: l.tipo, nome: l.nome,
      telefone: l.telefone, pet: l.pet, retomadaEm: l.retomada_em,
    }));
  }

  // Marca que a equipe já mandou (ou decidiu não mandar) a mensagem de retomada.
  async function marcarRetomada(id) {
    const agora = new Date().toISOString();
    if ((await obterModo()) === "local") {
      const lista = lerLS(LS_CONTATOS) || [];
      lista.forEach((l) => { if (l.id === id) l.retomadaEm = agora; });
      gravarLS(LS_CONTATOS, lista);
      return true;
    }
    await sb(
      "/rest/v1/contatos?id=eq." + encodeURIComponent(id),
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ retomada_em: agora }) },
      true
    );
    return true;
  }

  async function excluirContato(id) {
    if ((await obterModo()) === "local") {
      gravarLS(LS_CONTATOS, (lerLS(LS_CONTATOS) || []).filter((l) => l.id !== id));
      return true;
    }
    await sb("/rest/v1/contatos?id=eq." + encodeURIComponent(id), { method: "DELETE" }, true);
    return true;
  }

  // ---------- lembretes de 30 dias (banho e tosa) ----------

  async function listarLembretes() {
    if ((await obterModo()) === "local") return lerLS(LS_LEMBRETES) || [];
    const linhas = await sb(
      "/rest/v1/lembretes?select=id,telefone,acao,enviado_em&order=enviado_em.desc&limit=1000",
      {},
      true
    );
    return (linhas || []).map((l) => ({ id: l.id, telefone: l.telefone, acao: l.acao, enviadoEm: l.enviado_em }));
  }

  // acao: "enviado" (abriu o WhatsApp com a mensagem) ou "pulado" (não quis mandar dessa vez)
  async function registrarLembrete(telefone, acao) {
    const linha = {
      id: gerarId(),
      telefone: String(telefone || "").replace(/\D/g, ""),
      acao: acao === "pulado" ? "pulado" : "enviado",
    };
    if ((await obterModo()) === "local") {
      const lista = lerLS(LS_LEMBRETES) || [];
      lista.unshift(Object.assign({ enviadoEm: new Date().toISOString() }, linha));
      gravarLS(LS_LEMBRETES, lista.slice(0, 1000));
      return true;
    }
    await sb(
      "/rest/v1/lembretes",
      { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(linha) },
      true
    );
    return true;
  }

  // ---------- visitas ao site ----------

  function idVisitante() {
    let id = lerLS(LS_VISITANTE);
    if (!id) {
      id = gerarId();
      gravarLS(LS_VISITANTE, id);
    }
    return id;
  }

  // Conta 1 acesso por sessão do navegador (recarregar a página não conta de novo).
  // Nunca atrapalha o site: qualquer erro é engolido.
  async function registrarVisita() {
    try {
      try {
        if (sessionStorage.getItem(SS_VISITA)) return;
        sessionStorage.setItem(SS_VISITA, "1");
      } catch (e) { /* sem sessionStorage: conta mesmo assim */ }
      const visitante = idVisitante();
      if ((await obterModo()) === "local") {
        const lista = lerLS(LS_VISITAS) || [];
        lista.push({ v: visitante, t: new Date().toISOString() });
        gravarLS(LS_VISITAS, lista.slice(-3000));
        return;
      }
      await sb("/rest/v1/visitas", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ visitante: visitante }),
      });
    } catch (e) {
      console.warn("AgroStore: visita não registrada.", e);
    }
  }

  function inicioDoDia(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // { hoje, semana, mes } → cada um { acessos, visitantes }.
  // semana = hoje + 6 dias anteriores; mes = desde o dia 1 do mês atual.
  async function resumoVisitas() {
    if ((await obterModo()) === "local") {
      const agora = new Date();
      const hoje = inicioDoDia(agora).getTime();
      const semana = hoje - 6 * 864e5;
      const mes = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
      const r = {};
      [["hoje", hoje], ["semana", semana], ["mes", mes]].forEach(([k, desde]) => {
        const doPeriodo = (lerLS(LS_VISITAS) || []).filter((x) => new Date(x.t).getTime() >= desde);
        r[k] = { acessos: doPeriodo.length, visitantes: new Set(doPeriodo.map((x) => x.v)).size };
      });
      return r;
    }
    return sb("/rest/v1/rpc/resumo_visitas", { method: "POST", body: "{}" }, true);
  }

  // ---------- login ----------

  async function entrar(email, senha) {
    const c = await obterConfig();
    if (!supabaseLigado(c)) {
      if (senha !== (c.senhaPainel || "agrocampo")) throw new Error("Senha incorreta.");
      const s = { local: true, email: "Agrocampo" };
      gravarLS(LS_SESSAO, s);
      return { email: s.email };
    }
    const s = await sbAuth("password", { email: String(email || "").trim(), password: senha });
    gravarLS(LS_SESSAO, s);
    return { email: s.email };
  }

  async function sair() {
    const s = lerLS(LS_SESSAO);
    gravarLS(LS_SESSAO, null);
    if (s && !s.local && (await obterModo()) === "supabase") {
      const c = await obterConfig();
      fetch((await urlBase()) + "/auth/v1/logout", {
        method: "POST",
        headers: { apikey: c.supabaseAnonKey, Authorization: "Bearer " + s.access_token },
      }).catch(function () {});
    }
  }

  async function usuarioAtual() {
    const s = await sessaoValida();
    return s ? { email: s.email } : null;
  }

  // ---------- imagens ----------

  function redimensionar(arquivo, ladoMax, qualidade) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(arquivo);
      const img = new Image();
      img.onload = function () {
        const escala = Math.min(1, ladoMax / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // PNG transparente não fica preto no JPEG
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          function (blob) { blob ? resolve(blob) : reject(new Error("Não consegui processar a foto.")); },
          "image/jpeg",
          qualidade
        );
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Esse arquivo não parece ser uma foto."));
      };
      img.src = url;
    });
  }

  function blobParaDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      const leitor = new FileReader();
      leitor.onload = function () { resolve(leitor.result); };
      leitor.onerror = reject;
      leitor.readAsDataURL(blob);
    });
  }

  async function enviarImagem(arquivo) {
    if ((await obterModo()) === "local") {
      // Demo: foto pequena embutida (localStorage tem ~5 MB no total)
      return blobParaDataUrl(await redimensionar(arquivo, 700, 0.72));
    }
    const blob = await redimensionar(arquivo, 1400, 0.82);
    const hoje = new Date().toISOString().slice(0, 10);
    const caminho = hoje + "/" + gerarId() + ".jpg";
    await sb(
      "/storage/v1/object/fotos/" + caminho,
      { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob },
      true
    );
    return (await urlBase()) + "/storage/v1/object/public/fotos/" + caminho;
  }

  window.AgroStore = {
    STATUS: STATUS.slice(),
    TIPOS: TIPOS.slice(),
    obterModo: obterModo,
    carregarDados: carregarDados,
    salvarDados: salvarDados,
    salvarAgendamento: salvarAgendamento,
    listarAgendamentos: listarAgendamentos,
    atualizarStatus: atualizarStatus,
    excluirAgendamento: excluirAgendamento,
    registrarContato: registrarContato,
    listarContatos: listarContatos,
    marcarRetomada: marcarRetomada,
    excluirContato: excluirContato,
    listarLembretes: listarLembretes,
    registrarLembrete: registrarLembrete,
    registrarVisita: registrarVisita,
    resumoVisitas: resumoVisitas,
    entrar: entrar,
    sair: sair,
    usuarioAtual: usuarioAtual,
    enviarImagem: enviarImagem,
  };
})();
