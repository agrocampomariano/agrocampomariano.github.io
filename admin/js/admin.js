/*
 * Painel admin — Agrocampo Mariano.
 * Toda leitura/gravação passa por window.AgroStore (js/store.js).
 */
(function () {
  "use strict";

  const Store = window.AgroStore;
  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

  const estado = {
    modo: "local",
    dados: null,
    pedidos: [],
    filtro: "novo",
    produtoEditando: -1, // índice em dados.produtos, -1 = novo
    produtoImagem: null,
    infoSuja: false,
    timerPedidos: null,
    novosAntes: null,
  };

  const ROTULO_TIPO = {
    "banho-tosa": "✂️ Banho e tosa",
    veterinario: "🩺 Veterinário",
    medicamento: "💊 Medicamento",
  };
  const ROTULO_STATUS = {
    novo: "Novo",
    confirmado: "Confirmado",
    concluido: "Concluído",
    cancelado: "Cancelado",
  };

  // ---------- utilidades ----------

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clonar(o) {
    return JSON.parse(JSON.stringify(o));
  }

  // Caminhos do dados.js são relativos à raiz do site; o painel está em /admin/.
  function urlImagem(u) {
    if (!u) return "";
    return /^(https?:|data:|blob:|\/)/.test(u) ? u : "../" + u;
  }

  function digitos(v) {
    return String(v || "").replace(/\D/g, "");
  }

  // "(48) 3632-7929" → "554836327929"
  function paraWhatsapp(v) {
    const d = digitos(v);
    if (d.length === 10 || d.length === 11) return "55" + d;
    return d;
  }

  // "554836327929" → "(48) 3632-7929"
  function formatarTelefone(v) {
    let d = digitos(v);
    if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    return v || "";
  }

  function formatarPreco(p) {
    if (p === null || p === undefined || p === "") return "Sem preço no site";
    return Number(p).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  // "89,90" / "R$ 1.234,50" / "10" → número; "" → null; inválido → NaN
  function lerPreco(txt) {
    let t = String(txt || "").replace(/R\$\s?/i, "").trim();
    if (!t) return null;
    if (t.indexOf(",") >= 0) t = t.replace(/\./g, "").replace(",", ".");
    const n = Number(t);
    return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
  }

  function precoParaCampo(p) {
    if (p === null || p === undefined || p === "") return "";
    return Number(p).toFixed(2).replace(".", ",");
  }

  function gerarIdServico(nome, existentes) {
    const base =
      nome
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "servico";
    let id = base;
    let n = 2;
    while (existentes.some((s) => s.id === id)) id = base + "-" + n++;
    return id;
  }

  function tempoRelativo(iso) {
    const t = new Date(iso).getTime();
    if (!t) return "";
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return "agora mesmo";
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    return new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function formatarDataPedido(data) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data || "");
    if (!m) return data || "";
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const semana = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
    return `${semana}, ${m[3]}/${m[2]}/${m[1]}`;
  }

  let timerToast = null;
  function aviso(msg, erro) {
    const el = $("#aviso-toast");
    el.textContent = msg;
    el.classList.toggle("toast--erro", !!erro);
    el.classList.add("visivel");
    clearTimeout(timerToast);
    timerToast = setTimeout(() => el.classList.remove("visivel"), erro ? 5000 : 2600);
  }

  let carregandoN = 0;
  async function ocupado(promessa) {
    carregandoN++;
    $("#carregando").classList.add("ativo");
    try {
      return await promessa;
    } finally {
      if (--carregandoN === 0) $("#carregando").classList.remove("ativo");
    }
  }

  function tratarErro(e) {
    console.error(e);
    if (e && e.sessao) {
      aviso("Sua sessão expirou. Entre de novo.", true);
      mostrarLogin();
      return;
    }
    aviso((e && e.message) || "Algo deu errado. Tente de novo.", true);
  }

  // Aplica uma mudança nos dados e salva; se falhar, desfaz.
  async function salvarMudanca(mudar, mensagem) {
    const antes = clonar(estado.dados);
    mudar(estado.dados);
    renderizarConteudo();
    try {
      await ocupado(Store.salvarDados(estado.dados));
      aviso(mensagem || "Salvo ✓");
      return true;
    } catch (e) {
      estado.dados = antes;
      renderizarConteudo();
      tratarErro(e);
      return false;
    }
  }

  // ---------- login ----------

  function mostrarLogin() {
    pararPedidos();
    $("#tela-app").hidden = true;
    $("#tela-login").hidden = false;
    const demo = estado.modo === "local";
    $("#campo-email").hidden = demo;
    $("#login-email").required = !demo;
    setTimeout(() => (demo ? $("#login-senha") : $("#login-email")).focus(), 50);
  }

  async function aoEntrar(ev) {
    ev.preventDefault();
    const erro = $("#login-erro");
    const botao = $("#login-botao");
    erro.hidden = true;
    const email = $("#login-email").value;
    const senha = $("#login-senha").value;
    if ((estado.modo !== "local" && !email) || !senha) {
      erro.textContent = "Preencha " + (estado.modo === "local" ? "a senha." : "e-mail e senha.");
      erro.hidden = false;
      return;
    }
    botao.disabled = true;
    botao.textContent = "Entrando…";
    try {
      const usuario = await Store.entrar(email, senha);
      $("#login-senha").value = "";
      await abrirApp(usuario);
    } catch (e) {
      erro.textContent = e.message || "Não foi possível entrar.";
      erro.hidden = false;
    } finally {
      botao.disabled = false;
      botao.textContent = "Entrar";
    }
  }

  async function aoSair() {
    if (estado.infoSuja && !confirm("Você tem alterações não salvas na aba Loja. Sair mesmo assim?")) return;
    estado.infoSuja = false;
    await Store.sair();
    mostrarLogin();
  }

  // ---------- app ----------

  async function abrirApp(usuario) {
    $("#tela-login").hidden = true;
    $("#tela-app").hidden = false;
    $("#topo-usuario").textContent = usuario && usuario.email ? usuario.email : "";

    estado.dados = await ocupado(Store.carregarDados());
    renderizarConteudo();
    preencherInfo();
    trocarAba((location.hash || "").slice(1) || "pedidos");
    await carregarPedidos();
    iniciarPedidos();
  }

  function renderizarConteudo() {
    renderizarProdutos();
    renderizarServicos();
    renderizarFotos();
  }

  function trocarAba(nome) {
    if (!$("#aba-" + nome)) nome = "pedidos";
    $$(".aba").forEach((b) => {
      const ativa = b.dataset.aba === nome;
      b.classList.toggle("ativa", ativa);
      b.setAttribute("aria-current", ativa ? "page" : "false");
    });
    $$(".painel").forEach((p) => (p.hidden = p.id !== "aba-" + nome));
    if (location.hash.slice(1) !== nome) history.replaceState(null, "", "#" + nome);
    window.scrollTo(0, 0);
  }

  // ---------- pedidos ----------

  async function carregarPedidos(silencioso) {
    try {
      const lista = await (silencioso ? Store.listarAgendamentos() : ocupado(Store.listarAgendamentos()));
      estado.pedidos = lista;
      renderizarPedidos();
    } catch (e) {
      if (!silencioso || (e && e.sessao)) tratarErro(e);
    }
  }

  function iniciarPedidos() {
    pararPedidos();
    estado.timerPedidos = setInterval(() => {
      if (document.visibilityState === "visible") carregarPedidos(true);
    }, 30000);
  }

  function pararPedidos() {
    clearInterval(estado.timerPedidos);
    estado.timerPedidos = null;
  }

  function renderizarPedidos() {
    const contagem = { novo: 0, confirmado: 0, concluido: 0, cancelado: 0 };
    estado.pedidos.forEach((p) => {
      if (contagem[p.status] !== undefined) contagem[p.status]++;
    });

    // aviso de pedido novo + contador na aba e no título da página
    if (estado.novosAntes !== null && contagem.novo > estado.novosAntes) aviso("🔔 Chegou pedido novo!");
    estado.novosAntes = contagem.novo;
    const badge = $("#contador-novos");
    badge.hidden = contagem.novo === 0;
    badge.textContent = contagem.novo;
    document.title = (contagem.novo ? `(${contagem.novo}) ` : "") + "Painel · Agrocampo Mariano";

    $$("#filtros-pedidos .filtro").forEach((b) => {
      const f = b.dataset.filtro;
      b.classList.toggle("ativo", f === estado.filtro);
      const n = f === "todos" ? estado.pedidos.length : contagem[f];
      b.innerHTML = esc(b.textContent.replace(/\s*\d+$/, "")) + (n ? ` <b>${n}</b>` : "");
    });

    const lista =
      estado.filtro === "todos" ? estado.pedidos : estado.pedidos.filter((p) => p.status === estado.filtro);
    const alvo = $("#lista-pedidos");

    if (!lista.length) {
      const msgs = {
        novo: ["Nenhum pedido novo", "Quando um cliente agendar pelo site, ele aparece aqui."],
        confirmado: ["Nenhum pedido confirmado", "Os pedidos que você confirmar ficam aqui."],
        concluido: ["Nada concluído ainda", ""],
        cancelado: ["Nenhum pedido cancelado", ""],
        todos: ["Ainda não chegou nenhum pedido", "Quando um cliente agendar pelo site, ele aparece aqui."],
      };
      const [t, s] = msgs[estado.filtro];
      alvo.innerHTML = `<div class="vazio"><strong>${t}</strong>${s}</div>`;
      return;
    }

    alvo.innerHTML = lista.map(cartaoPedido).join("");
  }

  function cartaoPedido(p) {
    const tutor = p.tutor || {};
    const pet = p.pet || {};
    const linhas = [];
    const add = (rotulo, valor) => {
      if (valor) linhas.push(`<dt>${rotulo}</dt><dd>${valor}</dd>`);
    };

    add("Telefone", esc(tutor.telefone));
    const petDesc = [pet.especie, pet.porte ? "porte " + pet.porte : ""].filter(Boolean).join(", ");
    add("Animal", esc([pet.nome, petDesc ? `(${petDesc})` : ""].filter(Boolean).join(" ")));
    add("Serviço", esc(p.servico));
    add("Data", esc([formatarDataPedido(p.data), p.periodo].filter(Boolean).join(" · ")));
    if (p.itens && p.itens.length) add("Itens", "<ul>" + p.itens.map((i) => `<li>${esc(i)}</li>`).join("") + "</ul>");
    add("Obs.", esc(p.observacoes));

    const tel = paraWhatsapp(tutor.telefone);
    const msg = encodeURIComponent(
      `Olá${tutor.nome ? ", " + tutor.nome.split(" ")[0] : ""}! Aqui é da ${estado.dados.nome || "Agrocampo Mariano"}, sobre o seu pedido pelo site.`
    );
    const botaoWhats =
      tel.length >= 12
        ? `<a class="botao botao--verde botao--pequeno" href="https://wa.me/${tel}?text=${msg}" target="_blank" rel="noopener">WhatsApp</a>`
        : "";

    const acoesStatus = {
      novo: [["confirmado", "Confirmar", "botao--primario"], ["cancelado", "Cancelar", "botao--perigo"]],
      confirmado: [["concluido", "Concluído ✓", "botao--primario"], ["cancelado", "Cancelar", "botao--perigo"]],
      concluido: [["novo", "Reabrir", "botao--fantasma"]],
      cancelado: [["novo", "Reabrir", "botao--fantasma"]],
    }[p.status] || [["novo", "Reabrir", "botao--fantasma"]];

    const id = esc(p.id);
    const status = ROTULO_STATUS[p.status] ? p.status : "novo";
    return `
      <article class="pedido pedido--${status}">
        <div class="pedido__topo">
          <span class="pedido__tipo">${esc(ROTULO_TIPO[p.tipo] || p.tipo || "Pedido")}${
            p.origem ? ` <span class="pedido__origem">${p.origem === "chat" ? "via chat" : "via " + esc(p.origem)}</span>` : ""
          }</span>
          <span><span class="selo selo--${status}">${ROTULO_STATUS[status]}</span>
          <span class="pedido__quando">${esc(tempoRelativo(p.recebidoEm || p.criadoEm))}</span></span>
        </div>
        <h3 class="pedido__nome">${esc(tutor.nome || "Cliente sem nome")}</h3>
        <dl class="pedido__dados">${linhas.join("")}</dl>
        <div class="pedido__acoes">
          ${botaoWhats}
          ${acoesStatus
            .map(([s, rotulo, cls]) => `<button type="button" class="botao botao--pequeno ${cls}" data-status="${s}" data-id="${id}">${rotulo}</button>`)
            .join("")}
          <button type="button" class="botao botao--texto botao--pequeno" data-excluir="${id}">Excluir</button>
        </div>
      </article>`;
  }

  async function aoClicarPedido(ev) {
    const botaoStatus = ev.target.closest("[data-status]");
    const botaoExcluir = ev.target.closest("[data-excluir]");
    if (botaoStatus) {
      const { id, status } = botaoStatus.dataset;
      if (status === "cancelado" && !confirm("Cancelar esse pedido?")) return;
      botaoStatus.disabled = true;
      try {
        await ocupado(Store.atualizarStatus(id, status));
        const p = estado.pedidos.find((x) => x.id === id);
        if (p) p.status = status;
        renderizarPedidos();
        aviso("Pedido marcado como " + ROTULO_STATUS[status].toLowerCase());
      } catch (e) {
        botaoStatus.disabled = false;
        tratarErro(e);
      }
    } else if (botaoExcluir) {
      if (!confirm("Excluir esse pedido de vez? Não dá pra desfazer.")) return;
      const id = botaoExcluir.dataset.excluir;
      try {
        await ocupado(Store.excluirAgendamento(id));
        estado.pedidos = estado.pedidos.filter((x) => x.id !== id);
        renderizarPedidos();
        aviso("Pedido excluído");
      } catch (e) {
        tratarErro(e);
      }
    }
  }

  // ---------- informações da loja ----------

  function preencherInfo() {
    const f = $("#form-info");
    const d = estado.dados;
    const v = d.veterinario || {};
    f.whatsapp.value = formatarTelefone(d.whatsapp);
    f.endereco.value = d.endereco || "";
    f.horario.value = d.horario || "";
    f.instagram.value = d.instagram || "";
    f.email.value = d.email || "";
    f.vet_nome.value = v.nome || "";
    f.vet_cargo.value = v.cargo || "";
    f.vet_experiencia.value = v.experiencia || "";
    f.vet_whatsapp.value = formatarTelefone(v.whatsapp);
    f.vet_instagram.value = v.instagram || "";
    mostrarPrevia($("#vet-foto-previa"), v.foto, "Sem foto");
    estado.infoSuja = false;
  }

  function arroba(v) {
    v = String(v || "").trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/+$/, "");
    return v && !v.startsWith("@") ? "@" + v : v;
  }

  async function aoSalvarInfo(ev) {
    ev.preventDefault();
    const f = ev.target;
    const zap = paraWhatsapp(f.whatsapp.value);
    if (zap.length < 12) {
      aviso("Confira o WhatsApp da loja — coloque com DDD, ex.: (48) 3632-7929", true);
      f.whatsapp.focus();
      return;
    }
    if (!f.endereco.value.trim() || !f.horario.value.trim()) {
      aviso("Endereço e horário não podem ficar vazios.", true);
      return;
    }
    const zapVet = f.vet_whatsapp.value.trim() ? paraWhatsapp(f.vet_whatsapp.value) : "";
    if (zapVet && zapVet.length < 12) {
      aviso("Confira o WhatsApp do veterinário — coloque com DDD.", true);
      f.vet_whatsapp.focus();
      return;
    }
    const botao = f.querySelector('[type="submit"]');
    botao.disabled = true;
    const ok = await salvarMudanca((d) => {
      d.whatsapp = zap;
      d.endereco = f.endereco.value.trim();
      d.horario = f.horario.value.trim();
      d.instagram = arroba(f.instagram.value);
      d.email = f.email.value.trim();
      d.veterinario = Object.assign({}, d.veterinario, {
        nome: f.vet_nome.value.trim(),
        cargo: f.vet_cargo.value.trim(),
        experiencia: f.vet_experiencia.value.trim(),
        whatsapp: zapVet,
        instagram: arroba(f.vet_instagram.value),
      });
    }, "Informações salvas ✓");
    botao.disabled = false;
    if (ok) preencherInfo();
  }

  async function aoTrocarFotoVet(ev) {
    const arquivo = ev.target.files[0];
    ev.target.value = "";
    if (!arquivo) return;
    try {
      const url = await ocupado(Store.enviarImagem(arquivo));
      await salvarMudanca((d) => {
        d.veterinario = Object.assign({}, d.veterinario, { foto: url });
      }, "Foto do veterinário salva ✓");
      mostrarPrevia($("#vet-foto-previa"), estado.dados.veterinario.foto, "Sem foto");
    } catch (e) {
      tratarErro(e);
    }
  }

  function mostrarPrevia(el, url, textoVazio) {
    el.innerHTML = url
      ? `<img src="${esc(urlImagem(url))}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" onerror="this.replaceWith(document.createTextNode('${textoVazio}'))" />`
      : esc(textoVazio);
  }

  // ---------- produtos ----------

  function renderizarProdutos() {
    const busca = $("#busca-produto").value.trim().toLowerCase();
    const produtos = estado.dados.produtos || [];
    const lista = produtos
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !busca || (p.nome + " " + p.categoria).toLowerCase().includes(busca));

    $("#categorias").innerHTML = [...new Set(produtos.map((p) => p.categoria).filter(Boolean))]
      .map((c) => `<option value="${esc(c)}"></option>`)
      .join("");

    const alvo = $("#lista-produtos");
    if (!produtos.length) {
      alvo.innerHTML = `<div class="vazio"><strong>Nenhum produto cadastrado</strong>Toque em “+ Novo produto” pra começar.</div>`;
      return;
    }
    if (!lista.length) {
      alvo.innerHTML = `<div class="vazio">Nenhum produto encontrado pra “${esc(busca)}”.</div>`;
      return;
    }
    alvo.innerHTML = lista
      .map(
        ({ p, i }) => `
        <div class="produto">
          <div class="produto__foto">🛍️${
            p.imagem ? `<img src="${esc(urlImagem(p.imagem))}" alt="" loading="lazy" onerror="this.remove()" />` : ""
          }</div>
          <div class="produto__info">
            <div class="produto__categoria">${esc(p.categoria)}</div>
            <div class="produto__nome">${esc(p.nome)}</div>
            <div class="produto__preco">${esc(formatarPreco(p.preco))}</div>
          </div>
          <div class="produto__acoes">
            <button type="button" class="botao-icone" data-editar="${i}" aria-label="Editar ${esc(p.nome)}">✏️</button>
            <button type="button" class="botao-icone botao-icone--perigo" data-apagar="${i}" aria-label="Excluir ${esc(p.nome)}">🗑️</button>
          </div>
        </div>`
      )
      .join("");
  }

  function abrirProduto(indice) {
    const f = $("#form-produto");
    const p = indice >= 0 ? estado.dados.produtos[indice] : { nome: "", categoria: "", preco: null, imagem: null };
    estado.produtoEditando = indice;
    estado.produtoImagem = p.imagem || null;
    $("#janela-produto-titulo").textContent = indice >= 0 ? "Editar produto" : "Novo produto";
    f.nome.value = p.nome || "";
    f.categoria.value = p.categoria || "";
    f.preco.value = precoParaCampo(p.preco);
    $("#produto-erro").hidden = true;
    mostrarPrevia($("#produto-foto-previa"), estado.produtoImagem, "Sem foto");
    $("#janela-produto").showModal();
    if (indice < 0) setTimeout(() => f.nome.focus(), 50);
  }

  function fecharProduto() {
    $("#janela-produto").close();
  }

  async function aoSalvarProduto(ev) {
    ev.preventDefault();
    const f = ev.target;
    const erro = $("#produto-erro");
    const nome = f.nome.value.trim();
    const categoria = f.categoria.value.trim();
    const preco = lerPreco(f.preco.value);
    erro.hidden = true;
    if (!nome || !categoria) {
      erro.textContent = "Preencha o nome e a categoria.";
      erro.hidden = false;
      return;
    }
    if (Number.isNaN(preco)) {
      erro.textContent = "Preço inválido. Use só números, ex.: 89,90";
      erro.hidden = false;
      return;
    }
    const indice = estado.produtoEditando;
    const botao = $("#produto-salvar");
    botao.disabled = true;
    const ok = await salvarMudanca((d) => {
      d.produtos = d.produtos || [];
      const novo = Object.assign({}, indice >= 0 ? d.produtos[indice] : {}, {
        nome,
        categoria,
        preco,
        imagem: estado.produtoImagem,
      });
      if (indice >= 0) d.produtos[indice] = novo;
      else d.produtos.unshift(novo);
    }, indice >= 0 ? "Produto atualizado ✓" : "Produto adicionado ✓");
    botao.disabled = false;
    if (ok) fecharProduto();
  }

  async function aoEscolherFotoProduto(ev) {
    const arquivo = ev.target.files[0];
    ev.target.value = "";
    if (!arquivo) return;
    const botao = $("#produto-salvar");
    botao.disabled = true;
    try {
      estado.produtoImagem = await ocupado(Store.enviarImagem(arquivo));
      mostrarPrevia($("#produto-foto-previa"), estado.produtoImagem, "Sem foto");
    } catch (e) {
      tratarErro(e);
    } finally {
      botao.disabled = false;
    }
  }

  async function aoClicarProduto(ev) {
    const editar = ev.target.closest("[data-editar]");
    const apagar = ev.target.closest("[data-apagar]");
    if (editar) abrirProduto(Number(editar.dataset.editar));
    if (apagar) {
      const i = Number(apagar.dataset.apagar);
      const p = estado.dados.produtos[i];
      if (!confirm(`Excluir “${p.nome}” do catálogo?`)) return;
      await salvarMudanca((d) => d.produtos.splice(i, 1), "Produto excluído");
    }
  }

  // ---------- serviços ----------

  function renderizarServicos() {
    const servicos = estado.dados.servicos || [];
    const alvo = $("#lista-servicos");
    if (!servicos.length) {
      alvo.innerHTML = `<li class="vazio">Nenhum serviço cadastrado.</li>`;
      return;
    }
    alvo.innerHTML = servicos
      .map(
        (s, i) => `
        <li class="servico">
          <input type="text" value="${esc(s.nome)}" data-renomear="${i}" aria-label="Nome do serviço" />
          <button type="button" class="botao-icone" data-subir="${i}" aria-label="Subir" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="botao-icone botao-icone--perigo" data-remover="${i}" aria-label="Excluir ${esc(s.nome)}">🗑️</button>
        </li>`
      )
      .join("");
  }

  async function aoAdicionarServico(ev) {
    ev.preventDefault();
    const campo = $("#novo-servico");
    const nome = campo.value.trim();
    if (!nome) return;
    const ok = await salvarMudanca((d) => {
      d.servicos = d.servicos || [];
      d.servicos.push({ id: gerarIdServico(nome, d.servicos), nome });
    }, "Serviço adicionado ✓");
    if (ok) campo.value = "";
  }

  async function aoRenomearServico(ev) {
    const campo = ev.target.closest("[data-renomear]");
    if (!campo) return;
    const i = Number(campo.dataset.renomear);
    const nome = campo.value.trim();
    const atual = estado.dados.servicos[i];
    if (!nome) {
      campo.value = atual.nome;
      return;
    }
    if (nome === atual.nome) return;
    await salvarMudanca((d) => (d.servicos[i] = Object.assign({}, d.servicos[i], { nome })), "Serviço renomeado ✓");
  }

  async function aoClicarServico(ev) {
    const remover = ev.target.closest("[data-remover]");
    const subir = ev.target.closest("[data-subir]");
    if (remover) {
      const i = Number(remover.dataset.remover);
      if (!confirm(`Excluir o serviço “${estado.dados.servicos[i].nome}”?`)) return;
      await salvarMudanca((d) => d.servicos.splice(i, 1), "Serviço excluído");
    }
    if (subir) {
      const i = Number(subir.dataset.subir);
      await salvarMudanca((d) => d.servicos.splice(i - 1, 0, d.servicos.splice(i, 1)[0]), "Ordem salva ✓");
    }
  }

  // ---------- fotos dos pets ----------

  function renderizarFotos() {
    const fotos = estado.dados.resultados || [];
    const alvo = $("#grade-fotos");
    if (!fotos.length) {
      alvo.innerHTML = `<div class="vazio" style="grid-column:1/-1"><strong>Nenhuma foto ainda</strong>Toque em “+ Adicionar fotos”.</div>`;
      return;
    }
    alvo.innerHTML = fotos
      .map(
        (f, i) => `
        <div class="foto">
          ${f.imagem ? `<img src="${esc(urlImagem(f.imagem))}" alt="Foto ${i + 1}" loading="lazy" />` : `<div class="foto__vazia">📷 Foto em breve</div>`}
          <div class="foto__acoes">
            <button type="button" class="botao-icone" data-mover="${i}" data-dir="-1" aria-label="Mover pra esquerda" ${i === 0 ? "disabled" : ""}>←</button>
            <button type="button" class="botao-icone botao-icone--perigo" data-tirar="${i}" aria-label="Excluir foto">🗑️</button>
            <button type="button" class="botao-icone" data-mover="${i}" data-dir="1" aria-label="Mover pra direita" ${i === fotos.length - 1 ? "disabled" : ""}>→</button>
          </div>
        </div>`
      )
      .join("");
  }

  async function aoAdicionarFotos(ev) {
    const arquivos = Array.from(ev.target.files || []);
    ev.target.value = "";
    if (!arquivos.length) return;
    const urls = [];
    try {
      for (const a of arquivos) urls.push(await ocupado(Store.enviarImagem(a)));
    } catch (e) {
      tratarErro(e);
    }
    if (!urls.length) return;
    await salvarMudanca((d) => {
      d.resultados = (d.resultados || []).concat(urls.map((imagem) => ({ imagem })));
    }, urls.length > 1 ? `${urls.length} fotos adicionadas ✓` : "Foto adicionada ✓");
  }

  async function aoClicarFoto(ev) {
    const tirar = ev.target.closest("[data-tirar]");
    const mover = ev.target.closest("[data-mover]");
    if (tirar) {
      if (!confirm("Tirar essa foto do site?")) return;
      const i = Number(tirar.dataset.tirar);
      await salvarMudanca((d) => d.resultados.splice(i, 1), "Foto removida");
    }
    if (mover) {
      const i = Number(mover.dataset.mover);
      const j = i + Number(mover.dataset.dir);
      await salvarMudanca((d) => {
        const r = d.resultados;
        [r[i], r[j]] = [r[j], r[i]];
      }, "Ordem salva ✓");
    }
  }

  // ---------- início ----------

  function ligarEventos() {
    $("#form-login").addEventListener("submit", aoEntrar);
    $("#botao-sair").addEventListener("click", aoSair);
    $$(".aba").forEach((b) => b.addEventListener("click", () => trocarAba(b.dataset.aba)));
    window.addEventListener("hashchange", () => trocarAba(location.hash.slice(1)));

    $("#filtros-pedidos").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-filtro]");
      if (!b) return;
      estado.filtro = b.dataset.filtro;
      renderizarPedidos();
    });
    $("#lista-pedidos").addEventListener("click", aoClicarPedido);
    $("#botao-atualizar").addEventListener("click", () => carregarPedidos());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && estado.timerPedidos) carregarPedidos(true);
    });

    const formInfo = $("#form-info");
    formInfo.addEventListener("submit", aoSalvarInfo);
    formInfo.addEventListener("input", () => (estado.infoSuja = true));
    $("#vet-foto-arquivo").addEventListener("change", aoTrocarFotoVet);

    $("#botao-novo-produto").addEventListener("click", () => abrirProduto(-1));
    $("#busca-produto").addEventListener("input", renderizarProdutos);
    $("#lista-produtos").addEventListener("click", aoClicarProduto);
    $("#form-produto").addEventListener("submit", aoSalvarProduto);
    $("#produto-foto-arquivo").addEventListener("change", aoEscolherFotoProduto);
    $("#produto-foto-remover").addEventListener("click", () => {
      estado.produtoImagem = null;
      mostrarPrevia($("#produto-foto-previa"), null, "Sem foto");
    });
    $$("#janela-produto [data-fechar]").forEach((b) => b.addEventListener("click", fecharProduto));

    $("#form-servico").addEventListener("submit", aoAdicionarServico);
    $("#lista-servicos").addEventListener("change", aoRenomearServico);
    $("#lista-servicos").addEventListener("click", aoClicarServico);

    $("#fotos-arquivo").addEventListener("change", aoAdicionarFotos);
    $("#grade-fotos").addEventListener("click", aoClicarFoto);

    window.addEventListener("beforeunload", (ev) => {
      if (estado.infoSuja) {
        ev.preventDefault();
        ev.returnValue = "";
      }
    });
  }

  async function iniciar() {
    if (!Store) {
      document.body.innerHTML = "<p style='padding:24px'>Erro: js/store.js não carregou.</p>";
      return;
    }
    ligarEventos();
    estado.modo = await Store.obterModo();
    const usuario = await Store.usuarioAtual();
    if (usuario) await abrirApp(usuario);
    else mostrarLogin();
  }

  iniciar().catch(tratarErro);
})();
