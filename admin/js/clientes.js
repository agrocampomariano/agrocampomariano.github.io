/*
 * Aba "Clientes" do painel — Agrocampo Mariano.
 *
 *  - Acessos ao site: hoje, últimos 7 dias e mês atual (AgroStore.resumoVisitas).
 *  - Mandar mensagem hoje: fila com
 *      · quem deu nome + WhatsApp no chat e não concluiu o pedido (retomada);
 *      · quem fez banho e tosa há 30 dias ou mais (lembrete, repete a cada 30 dias).
 *    O botão abre o WhatsApp com a mensagem pronta e tira a pessoa da fila.
 *  - Contatos do chat: quem concluiu e quem não concluiu.
 *
 * Fica separado do admin.js de propósito: só depende do window.AgroStore e do HTML da aba.
 */
(function () {
  "use strict";

  const Store = window.AgroStore;
  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

  const NOME_LOJA = "Agrocampo Mariano";
  const DIAS_LEMBRETE = 30;
  const ESPERA_RETOMADA_MIN = 30; // dá um tempo pra pessoa terminar sozinha antes de entrar na fila
  const DIA_MS = 864e5;

  const ROTULO_TIPO = {
    "banho-tosa": "✂️ Banho e tosa",
    veterinario: "🩺 Veterinário",
    medicamento: "💊 Remédio / produto",
  };

  const estado = {
    filtro: "incompleto",
    contatos: [],
    pedidos: [],
    lembretes: [],
    carregando: false,
  };

  // ---------- utilidades ----------

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Telefone sempre comparado sem o 55 do Brasil: "5548999990000" e "48999990000" são o mesmo.
  function telefoneChave(v) {
    let d = String(v || "").replace(/\D/g, "");
    if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
    return d;
  }

  function paraWhatsapp(v) {
    const d = telefoneChave(v);
    return d.length === 10 || d.length === 11 ? "55" + d : "";
  }

  function formatarTelefone(v) {
    const d = telefoneChave(v);
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    return v || "";
  }

  function primeiroNome(nome) {
    return String(nome || "").trim().split(/\s+/)[0] || "";
  }

  function inicioDoDia(t) {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  // Data do serviço: o dia pedido no chat ("2026-11-20") ou, sem ele, quando o pedido chegou.
  function dataDoServico(p) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(p.data || "");
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    const t = new Date(p.recebidoEm || p.criadoEm).getTime();
    return t ? inicioDoDia(t) : 0;
  }

  function quando(iso) {
    const t = new Date(iso).getTime();
    if (!t) return "";
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return "agora mesmo";
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    const dias = Math.round(h / 24);
    if (dias < 7) return `há ${dias} dia${dias > 1 ? "s" : ""}`;
    return new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }

  function aviso(msg, erro) {
    const el = $("#aviso-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("toast--erro", !!erro);
    el.classList.add("visivel");
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => el.classList.remove("visivel"), erro ? 5000 : 2600);
  }

  function tratarErro(e) {
    console.error(e);
    aviso(e && e.sessao ? "Sua sessão expirou. Entre de novo." : (e && e.message) || "Algo deu errado. Tente de novo.", true);
  }

  // ---------- mensagens prontas ----------

  function mensagemRetomada(c) {
    const oi = `Oi, ${primeiroNome(c.nome) || "tudo bem"}! Aqui é da ${NOME_LOJA}.`;
    if (c.tipo === "banho-tosa") {
      return `${oi} Vi que você começou a marcar banho e tosa${c.pet ? " pro " + c.pet : ""} pelo site e não chegou a concluir. Quer que eu marque por aqui? É só me dizer o dia e o período que fica melhor.`;
    }
    if (c.tipo === "veterinario") {
      return `${oi} Vi que você começou a pedir uma consulta com o veterinário pelo site e não chegou a concluir. Quer ajuda pra marcar? Me conta o que seu pet precisa.`;
    }
    if (c.tipo === "medicamento") {
      return `${oi} Vi que você começou um pedido de remédio/produto pelo site e não chegou a concluir. Me diz o que você precisa que eu vejo se tem aqui e já separo pra você.`;
    }
    return `${oi} Vi que você começou um pedido pelo site e não chegou a concluir. Posso te ajudar por aqui?`;
  }

  function mensagemLembrete(l) {
    const pet = l.pet ? "do " + l.pet : "do seu pet";
    return `Oi, ${primeiroNome(l.nome) || "tudo bem"}! Aqui é da ${NOME_LOJA}. Já faz ${l.dias} dias do último banho ${pet}. Bora marcar o próximo? Me diz o dia e o período que fica melhor.`;
  }

  function linkWhats(telefone, texto) {
    const tel = paraWhatsapp(telefone);
    return tel ? `https://wa.me/${tel}?text=${encodeURIComponent(texto)}` : "";
  }

  // ---------- cálculo: quem concluiu, quem entra na fila ----------

  function contatoConcluiu(c) {
    const tel = telefoneChave(c.telefone);
    const criado = new Date(c.criadoEm).getTime() || 0;
    return estado.pedidos.some(
      (p) =>
        (p.chatId && p.chatId === c.id) ||
        // concluiu em outra conversa depois (mesmo telefone e mesmo tipo de pedido)
        (telefoneChave(p.tutor && p.tutor.telefone) === tel &&
          p.tipo === c.tipo &&
          (new Date(p.recebidoEm || p.criadoEm).getTime() || 0) >= criado - 60000)
    );
  }

  function filaRetomada() {
    const limite = Date.now() - ESPERA_RETOMADA_MIN * 60000;
    const vistos = new Set();
    return estado.contatos
      .filter((c) => !c.retomadaEm && !contatoConcluiu(c) && (new Date(c.criadoEm).getTime() || 0) <= limite)
      .filter((c) => {
        // a mesma pessoa largando o mesmo tipo de pedido duas vezes: uma mensagem só
        const chave = telefoneChave(c.telefone) + "|" + c.tipo;
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      });
  }

  // Um lembrete por telefone, quando o último banho e tosa (ou o último lembrete) fez 30 dias.
  function filaLembretes() {
    const hoje = inicioDoDia(Date.now());
    const porTelefone = new Map();
    estado.pedidos
      .filter((p) => p.tipo === "banho-tosa" && p.status !== "cancelado")
      .forEach((p) => {
        const tel = telefoneChave(p.tutor && p.tutor.telefone);
        if (tel.length < 10) return;
        const data = dataDoServico(p);
        if (!data || data > hoje) return; // serviço ainda não aconteceu
        const atual = porTelefone.get(tel);
        if (!atual || data > atual.data) porTelefone.set(tel, { telefone: tel, data: data, pedido: p });
      });

    const ultimoLembrete = new Map();
    estado.lembretes.forEach((l) => {
      const tel = telefoneChave(l.telefone);
      const t = new Date(l.enviadoEm).getTime() || 0;
      if (t > (ultimoLembrete.get(tel) || 0)) ultimoLembrete.set(tel, t);
    });

    const fila = [];
    porTelefone.forEach((u, tel) => {
      const referencia = Math.max(u.data, inicioDoDia(ultimoLembrete.get(tel) || 0));
      if (hoje - referencia < DIAS_LEMBRETE * DIA_MS) return;
      const p = u.pedido;
      fila.push({
        telefone: tel,
        nome: (p.tutor && p.tutor.nome) || "",
        pet: (p.pet && p.pet.nome) || "",
        servico: p.servico || "",
        dias: Math.round((hoje - u.data) / DIA_MS),
        ultimo: u.data,
      });
    });
    return fila.sort((a, b) => b.dias - a.dias);
  }

  // ---------- desenho ----------

  function cartaoVisita(rotulo, r) {
    r = r || { acessos: 0, visitantes: 0 };
    return `
      <div class="visita">
        <div class="visita__rotulo">${rotulo}</div>
        <div class="visita__numero">${Number(r.visitantes) || 0}</div>
        <div class="visita__detalhe">${(Number(r.visitantes) || 0) === 1 ? "pessoa" : "pessoas"} · ${Number(r.acessos) || 0} acesso${Number(r.acessos) === 1 ? "" : "s"}</div>
      </div>`;
  }

  function desenharVisitas(resumo, modo) {
    const alvo = $("#clientes-visitas");
    if (!resumo) {
      alvo.innerHTML = `<p class="visitas__nota">Não deu pra carregar os acessos agora.</p>`;
      return;
    }
    alvo.innerHTML =
      cartaoVisita("Hoje", resumo.hoje) +
      cartaoVisita("Últimos 7 dias", resumo.semana) +
      cartaoVisita("Este mês", resumo.mes) +
      `<p class="visitas__nota">${
        modo === "local"
          ? "Conta os acessos feitos neste navegador."
          : "Cada pessoa conta uma vez por período; acesso = cada vez que alguém abre o site."
      }</p>`;
  }

  function cartaoFila(item) {
    const ehLembrete = item.tipoFila === "lembrete";
    const texto = ehLembrete ? mensagemLembrete(item) : mensagemRetomada(item);
    const href = linkWhats(item.telefone, texto);
    const linhas = [];
    linhas.push(`<dt>Telefone</dt><dd>${esc(formatarTelefone(item.telefone))}</dd>`);
    if (ehLembrete) {
      if (item.pet) linhas.push(`<dt>Pet</dt><dd>${esc(item.pet)}</dd>`);
      linhas.push(
        `<dt>Último banho</dt><dd>${esc(new Date(item.ultimo).toLocaleDateString("pt-BR"))} (${item.dias} dias)</dd>`
      );
    } else {
      linhas.push(`<dt>Pedido</dt><dd>${esc(ROTULO_TIPO[item.tipo] || item.tipo || "—")}</dd>`);
      if (item.pet) linhas.push(`<dt>Pet</dt><dd>${esc(item.pet)}</dd>`);
      linhas.push(`<dt>Parou</dt><dd>${esc(quando(item.criadoEm))}</dd>`);
    }
    const chave = ehLembrete ? `lembrete:${item.telefone}` : `retomada:${item.id}`;
    return `
      <article class="pedido">
        <div class="pedido__topo">
          <span class="selo ${ehLembrete ? "selo--lembrete" : "selo--incompleto"}">${
            ehLembrete ? `Lembrete de ${DIAS_LEMBRETE} dias` : "Não concluiu"
          }</span>
        </div>
        <h3 class="pedido__nome">${esc(item.nome || "Sem nome")}</h3>
        <dl class="pedido__dados">${linhas.join("")}</dl>
        <p class="mensagem-previa">${esc(texto)}</p>
        <div class="pedido__acoes">
          ${
            href
              ? `<a class="botao botao--verde botao--pequeno" href="${esc(href)}" target="_blank" rel="noopener" data-enviar="${esc(chave)}">Mandar no WhatsApp</a>`
              : `<span class="erro">Telefone inválido</span>`
          }
          <button type="button" class="botao botao--texto botao--pequeno" data-pular="${esc(chave)}">Não mandar</button>
        </div>
      </article>`;
  }

  function desenharFila() {
    const retomadas = filaRetomada().map((c) => Object.assign({ tipoFila: "retomada" }, c));
    const lembretes = filaLembretes().map((l) => Object.assign({ tipoFila: "lembrete" }, l));
    const itens = retomadas.concat(lembretes);
    estado.fila = itens;

    const badge = $("#contador-fila");
    if (badge) {
      badge.hidden = itens.length === 0;
      badge.textContent = itens.length;
    }

    $("#clientes-fila").innerHTML = itens.length
      ? itens.map(cartaoFila).join("")
      : `<div class="vazio"><strong>Ninguém pra chamar hoje</strong>Quem parar no meio do agendamento ou fizer ${DIAS_LEMBRETE} dias do último banho aparece aqui.</div>`;
  }

  function cartaoContato(c) {
    const concluiu = contatoConcluiu(c);
    const linhas = [
      `<dt>Telefone</dt><dd>${esc(formatarTelefone(c.telefone))}</dd>`,
      `<dt>Pedido</dt><dd>${esc(ROTULO_TIPO[c.tipo] || c.tipo || "—")}</dd>`,
    ];
    if (c.pet) linhas.push(`<dt>Pet</dt><dd>${esc(c.pet)}</dd>`);
    if (!concluiu && c.retomadaEm) linhas.push(`<dt>Mensagem</dt><dd>enviada ${esc(quando(c.retomadaEm))}</dd>`);
    const href = linkWhats(c.telefone, concluiu ? `Oi, ${primeiroNome(c.nome)}! Aqui é da ${NOME_LOJA}.` : mensagemRetomada(c));
    return `
      <article class="pedido ${concluiu ? "pedido--concluido" : ""}">
        <div class="pedido__topo">
          <span class="selo ${concluiu ? "selo--concluido" : "selo--incompleto"}">${concluiu ? "Concluiu" : "Não concluiu"}</span>
          <span class="pedido__quando">${esc(quando(c.criadoEm))}</span>
        </div>
        <h3 class="pedido__nome">${esc(c.nome || "Sem nome")}</h3>
        <dl class="pedido__dados">${linhas.join("")}</dl>
        <div class="pedido__acoes">
          ${href ? `<a class="botao botao--fantasma botao--pequeno" href="${esc(href)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          <button type="button" class="botao botao--texto botao--pequeno" data-excluir-contato="${esc(c.id)}">Excluir</button>
        </div>
      </article>`;
  }

  function desenharContatos() {
    const contagem = { incompleto: 0, concluido: 0, todos: estado.contatos.length };
    estado.contatos.forEach((c) => contagem[contatoConcluiu(c) ? "concluido" : "incompleto"]++);

    $$("#clientes-filtros .filtro").forEach((b) => {
      const f = b.dataset.filtro;
      b.classList.toggle("ativo", f === estado.filtro);
      b.innerHTML = esc(b.textContent.replace(/\s*\d+$/, "")) + (contagem[f] ? ` <b>${contagem[f]}</b>` : "");
    });

    const lista = estado.contatos.filter((c) => {
      if (estado.filtro === "todos") return true;
      return (estado.filtro === "concluido") === contatoConcluiu(c);
    });
    $("#clientes-lista").innerHTML = lista.length
      ? lista.map(cartaoContato).join("")
      : `<div class="vazio"><strong>${
          estado.filtro === "concluido" ? "Ninguém concluiu ainda" : estado.filtro === "incompleto" ? "Ninguém parou no meio" : "Nenhum contato ainda"
        }</strong>Aparece aqui quem deu nome e WhatsApp no chat do site.</div>`;
  }

  function desenharTudo() {
    desenharFila();
    desenharContatos();
  }

  // ---------- carregar ----------

  async function carregar(silencioso) {
    if (estado.carregando || !Store) return;
    estado.carregando = true;
    const barra = $("#carregando");
    if (!silencioso && barra) barra.classList.add("ativo");
    try {
      const [contatos, pedidos, lembretes, modo] = await Promise.all([
        Store.listarContatos(),
        Store.listarAgendamentos(),
        Store.listarLembretes(),
        Store.obterModo(),
      ]);
      estado.contatos = contatos || [];
      estado.pedidos = pedidos || [];
      estado.lembretes = lembretes || [];
      estado.carregouUmaVez = true;
      desenharTudo();
      let resumo = null;
      try {
        resumo = await Store.resumoVisitas();
      } catch (e) {
        console.warn("Resumo de visitas indisponível:", e);
      }
      desenharVisitas(resumo, modo);
    } catch (e) {
      if (!silencioso || (e && e.sessao)) tratarErro(e);
    } finally {
      estado.carregando = false;
      if (barra) barra.classList.remove("ativo");
    }
  }

  // ---------- ações ----------

  async function concluirItem(chave, acao) {
    const [tipo, id] = chave.split(/:(.*)/s);
    try {
      if (tipo === "retomada") {
        // marca também as outras conversas largadas da mesma pessoa pro mesmo tipo de pedido
        const alvo = estado.contatos.find((x) => x.id === id);
        const chave = alvo ? telefoneChave(alvo.telefone) + "|" + alvo.tipo : "";
        const mesmos = estado.contatos.filter(
          (c) => c.id === id || (!c.retomadaEm && chave && telefoneChave(c.telefone) + "|" + c.tipo === chave)
        );
        for (const c of mesmos) {
          await Store.marcarRetomada(c.id);
          c.retomadaEm = new Date().toISOString();
        }
      } else {
        await Store.registrarLembrete(id, acao);
        estado.lembretes.unshift({ telefone: id, acao: acao, enviadoEm: new Date().toISOString() });
      }
      desenharTudo();
      aviso(acao === "pulado" ? "Tirado da lista de hoje" : "Marcado como enviado ✓");
    } catch (e) {
      tratarErro(e);
    }
  }

  function aoClicarFila(ev) {
    const enviar = ev.target.closest("[data-enviar]");
    const pular = ev.target.closest("[data-pular]");
    if (enviar) {
      // o link abre o WhatsApp normalmente; aqui só tira da fila
      concluirItem(enviar.dataset.enviar, "enviado");
    } else if (pular) {
      if (!confirm("Tirar da lista sem mandar mensagem?")) return;
      concluirItem(pular.dataset.pular, "pulado");
    }
  }

  async function aoClicarContato(ev) {
    const botao = ev.target.closest("[data-excluir-contato]");
    if (!botao) return;
    if (!confirm("Excluir esse contato de vez? Não dá pra desfazer.")) return;
    const id = botao.dataset.excluirContato;
    try {
      await Store.excluirContato(id);
      estado.contatos = estado.contatos.filter((c) => c.id !== id);
      desenharTudo();
      aviso("Contato excluído");
    } catch (e) {
      tratarErro(e);
    }
  }

  // ---------- ligar ----------

  function abaVisivel() {
    const sec = $("#aba-clientes");
    const app = $("#tela-app");
    return sec && !sec.hidden && app && !app.hidden;
  }

  function iniciar() {
    if (!Store || !$("#aba-clientes")) return;
    $("#clientes-atualizar").addEventListener("click", () => carregar());
    $("#clientes-fila").addEventListener("click", aoClicarFila);
    $("#clientes-lista").addEventListener("click", aoClicarContato);
    $("#clientes-filtros").addEventListener("click", (ev) => {
      const b = ev.target.closest(".filtro");
      if (!b) return;
      estado.filtro = b.dataset.filtro;
      desenharContatos();
    });

    // Recarrega ao abrir a aba e quando o painel aparece depois do login
    // (pra o contador da aba já mostrar quantos estão na fila).
    new MutationObserver(() => {
      if (abaVisivel()) carregar();
    }).observe($("#aba-clientes"), { attributes: true, attributeFilter: ["hidden"] });
    new MutationObserver(() => {
      if (!$("#tela-app").hidden) carregar(true);
    }).observe($("#tela-app"), { attributes: true, attributeFilter: ["hidden"] });

    $$('.aba[data-aba="clientes"]').forEach((b) => b.addEventListener("click", () => setTimeout(() => carregar(), 0)));

    // O admin.js pode já ter aberto o painel antes deste arquivo ligar os observadores
    // (sessão salva + #clientes no endereço): confere agora e de novo logo depois.
    [0, 800, 2500].forEach((ms) =>
      setTimeout(() => {
        if (!$("#tela-app").hidden && !estado.carregouUmaVez) carregar(!abaVisivel());
      }, ms)
    );

    setInterval(() => {
      if (document.visibilityState === "visible" && !$("#tela-app").hidden) carregar(true);
    }, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
