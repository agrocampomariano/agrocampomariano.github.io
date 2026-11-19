/*
 * CHAT DE AGENDAMENTO — Agrocampo Mariano
 *
 * Conversa guiada (sem IA, sem servidor) pra:
 *   - agendar banho e tosa
 *   - pedir consulta com o veterinário
 *   - encomendar/reservar medicamentos e produtos
 *
 * Tudo que a pessoa responde fica salvo no navegador dela (localStorage).
 * Se fechar a página no meio, quando voltar a conversa continua de onde parou.
 * Nome, telefone e pets ficam guardados pra preencher os próximos pedidos.
 *
 * Ao confirmar:
 *   1. chama window.AgroStore.salvarAgendamento(pedido), se o painel admin estiver ativo
 *   2. abre o WhatsApp (loja ou veterinário) com a mensagem pronta
 *
 * Pra abrir o chat a partir de qualquer botão do site:
 *   <button onclick="AgroChat.abrir('banho')">…</button>   // 'banho' | 'vet' | 'remedio'
 */
(function () {
  "use strict";

  // dados.js declara `const DADOS_AGROCAMPO` (não vira window.DADOS_AGROCAMPO).
  // Se o painel admin estiver ativo, os dados salvos lá substituem esses.
  let D = typeof DADOS_AGROCAMPO !== "undefined" ? DADOS_AGROCAMPO : window.DADOS_AGROCAMPO || {};
  try {
    if (window.AgroStore && typeof window.AgroStore.carregarDados === "function") {
      Promise.resolve(window.AgroStore.carregarDados())
        .then((d) => {
          if (d && d.whatsapp) D = d;
        })
        .catch(() => {});
    }
  } catch (e) {}
  const CHAVE_RASCUNHO = "agrocampo-chat-rascunho-v1";
  const CHAVE_PERFIL = "agrocampo-chat-perfil-v1";
  const VALIDADE_RASCUNHO_DIAS = 30;

  // ---------- armazenamento local (nunca quebra o site se o navegador bloquear) ----------
  function ler(chave) {
    try {
      const bruto = localStorage.getItem(chave);
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) {
      return null;
    }
  }
  function gravar(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
    } catch (e) {}
  }
  function apagar(chave) {
    try {
      localStorage.removeItem(chave);
    } catch (e) {}
  }

  // ---------- utilidades ----------
  function soDigitos(t) {
    return String(t || "").replace(/\D/g, "");
  }
  function formatarTelefone(t) {
    const d = soDigitos(t).replace(/^55(?=\d{10,11}$)/, "");
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return t;
  }
  function hojeISO() {
    const h = new Date();
    h.setMinutes(h.getMinutes() - h.getTimezoneOffset());
    return h.toISOString().slice(0, 10);
  }
  function somarDiasISO(dias) {
    const h = new Date();
    h.setDate(h.getDate() + dias);
    h.setMinutes(h.getMinutes() - h.getTimezoneOffset());
    return h.toISOString().slice(0, 10);
  }
  function diaDaSemana(iso) {
    const [a, m, d] = iso.split("-").map(Number);
    return new Date(a, m - 1, d).getDay(); // 0 = domingo
  }
  const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  function dataBR(iso) {
    if (!iso) return "";
    const [a, m, d] = iso.split("-");
    return `${d}/${m} (${NOMES_DIA[diaDaSemana(iso)]})`;
  }
  function escapar(t) {
    return String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function primeiroNome(nome) {
    return String(nome || "").trim().split(/\s+/)[0] || "";
  }

  // ---------- perfil salvo (nome, telefone, pets) ----------
  function perfil() {
    return ler(CHAVE_PERFIL) || { nome: "", telefone: "", pets: [] };
  }
  function atualizarPerfil(r) {
    const p = perfil();
    if (r.tutorNome) p.nome = r.tutorNome;
    if (r.tutorTelefone) p.telefone = r.tutorTelefone;
    if (r.petNome) {
      const existente = p.pets.find((x) => x.nome.toLowerCase() === r.petNome.toLowerCase());
      const pet = { nome: r.petNome, especie: r.especie || "", porte: r.porte || "" };
      if (existente) Object.assign(existente, pet);
      else p.pets.push(pet);
    }
    gravar(CHAVE_PERFIL, p);
  }

  // ---------- passos reutilizáveis ----------
  const OPCAO_OUTRO_PET = "Outro pet";

  const passoEscolherPet = {
    id: "petEscolha",
    pular: () => perfil().pets.length === 0,
    pergunta: () => "É pra qual pet?",
    tipo: "opcoes",
    opcoes: () => perfil().pets.map((p) => p.nome).concat(OPCAO_OUTRO_PET),
    aoResponder: (v, r) => {
      const pet = perfil().pets.find((p) => p.nome === v);
      if (pet) {
        r.petNome = pet.nome;
        r.especie = pet.especie;
        r.porte = pet.porte;
        r._petSalvo = true;
      } else {
        r._petSalvo = false;
        delete r.petNome;
        delete r.especie;
        delete r.porte;
      }
    },
  };

  // Banho e tosa é só pra cachorro: não oferece pets salvos como gato e
  // registra o pedido sempre como cachorro.
  const caesSalvos = () => perfil().pets.filter((p) => p.especie !== "Gato");
  const passoEscolherCao = {
    ...passoEscolherPet,
    pular: () => caesSalvos().length === 0,
    opcoes: () => caesSalvos().map((p) => p.nome).concat(OPCAO_OUTRO_PET),
    aoResponder: (v, r) => {
      passoEscolherPet.aoResponder(v, r);
      r.especie = "Cachorro";
    },
  };

  const passoNomePet = {
    id: "petNome",
    pular: (r) => r._petSalvo,
    pergunta: () => "Qual o nome do pet?",
    tipo: "texto",
    placeholder: "Ex.: Thor",
    validar: (v) => (v.trim().length >= 2 ? "" : "Escreve o nome do pet, por favor."),
  };

  const passoTutorSalvo = {
    id: "usarPerfil",
    pular: () => !(perfil().nome && perfil().telefone),
    pergunta: () => {
      const p = perfil();
      return `Posso usar seus dados de antes? ${p.nome}, ${formatarTelefone(p.telefone)}.`;
    },
    tipo: "opcoes",
    opcoes: () => ["Sim, pode usar", "Não, vou passar outros"],
    aoResponder: (v, r) => {
      if (v.startsWith("Sim")) {
        const p = perfil();
        r.tutorNome = p.nome;
        r.tutorTelefone = p.telefone;
        r._tutorSalvo = true;
      } else {
        r._tutorSalvo = false;
      }
    },
  };

  const passoTutorNome = {
    id: "tutorNome",
    pular: (r) => r._tutorSalvo,
    pergunta: () => "Qual o seu nome?",
    tipo: "texto",
    placeholder: "Seu nome",
    validar: (v) => (v.trim().length >= 2 ? "" : "Escreve seu nome, por favor."),
  };

  const passoTutorTelefone = {
    id: "tutorTelefone",
    pular: (r) => r._tutorSalvo,
    pergunta: (r) => `Valeu, ${primeiroNome(r.tutorNome)}. Qual seu WhatsApp com DDD?`,
    tipo: "telefone",
    placeholder: "(48) 99999-9999",
    validar: (v) => {
      const d = soDigitos(v);
      return d.length === 10 || d.length === 11 ? "" : "Confere o número: precisa do DDD, tipo (48) 99999-9999.";
    },
  };

  function passoData(pergunta, opcional) {
    return {
      id: "data",
      pergunta: () => pergunta,
      tipo: "data",
      opcional: opcional || null,
      validar: (v) => {
        if (!v) return "Escolhe uma data.";
        if (v < hojeISO()) return "Essa data já passou.";
        if (diaDaSemana(v) === 0) return "Domingo a loja fica fechada. Escolhe outro dia.";
        return "";
      },
    };
  }

  const passoPeriodo = {
    id: "periodo",
    pular: (r) => !r.data,
    pergunta: (r) =>
      diaDaSemana(r.data) === 6
        ? "Sábado a gente atende só de manhã (8h às 12h). Fica de manhã mesmo?"
        : "Melhor de manhã ou de tarde?",
    tipo: "opcoes",
    opcoes: (r) => (diaDaSemana(r.data) === 6 ? ["Manhã"] : ["Manhã", "Tarde"]),
  };

  function passoObs(pergunta) {
    return {
      id: "obs",
      pergunta: () => pergunta,
      tipo: "texto",
      placeholder: "Escreve aqui…",
      opcional: "Nada a acrescentar",
    };
  }

  // ---------- os três atendimentos ----------
  const FLUXOS = {
    banho: {
      titulo: "Banho e tosa",
      destino: () => D.whatsapp,
      passos: [
        // primeiro os dados da pessoa (nome e contato), depois os do pet
        passoTutorSalvo,
        passoTutorNome,
        passoTutorTelefone,
        passoEscolherCao,
        passoNomePet,
        {
          id: "porte",
          pular: (r) => r._petSalvo,
          pergunta: () => "Qual o porte?",
          tipo: "opcoes",
          opcoes: () => ["Pequeno (até 10 kg)", "Médio (10 a 25 kg)", "Grande (mais de 25 kg)"],
          aoResponder: (v, r) => {
            r.especie = "Cachorro";
          },
        },
        {
          id: "servico",
          pergunta: () => "Qual serviço?",
          tipo: "opcoes",
          opcoes: () => (D.servicos && D.servicos.length ? D.servicos.map((s) => s.nome) : ["Banho", "Tosa", "Banho + Tosa"]),
        },
        passoData("Pra que dia? Atendemos de segunda a sábado."),
        passoPeriodo,
        passoObs("Alguma observação? Tipo de tosa, pet bravo, alergia…"),
      ],
      resumo: (r) => [
        ["Pet", `${r.petNome}${r.especie ? " · " + r.especie : ""}${r.porte ? " · " + r.porte.split(" (")[0] : ""}`],
        ["Serviço", r.servico],
        ["Quando", `${dataBR(r.data)}, ${String(r.periodo || "").toLowerCase()}`],
        ["Obs.", r.obs],
        ["Tutor", `${r.tutorNome} · ${formatarTelefone(r.tutorTelefone)}`],
      ],
      mensagem: (r) =>
        [
          "Olá! Quero agendar banho e tosa:",
          `Pet: ${r.petNome}${r.especie ? " (" + r.especie + (r.porte ? ", " + r.porte.split(" (")[0].toLowerCase() : "") + ")" : ""}`,
          `Serviço: ${r.servico}`,
          `Dia: ${dataBR(r.data)}, ${String(r.periodo || "").toLowerCase()}`,
          r.obs ? `Obs.: ${r.obs}` : "",
          `Tutor: ${r.tutorNome}, ${formatarTelefone(r.tutorTelefone)}`,
        ],
      pedido: (r) => ({
        tipo: "banho-tosa",
        servico: r.servico,
        pet: { nome: r.petNome, especie: r.especie || "", porte: r.porte || "" },
        data: r.data,
        periodo: r.periodo,
        itens: "",
      }),
      fim: "Pronto! Abri o WhatsApp da loja com o pedido. É só apertar enviar lá. A equipe confirma o horário por lá.",
    },

    vet: {
      titulo: "Consulta com o veterinário",
      destino: () => (D.veterinario && D.veterinario.whatsapp) || D.whatsapp,
      passos: [
        // primeiro os dados da pessoa (nome e contato), depois os do pet
        passoTutorSalvo,
        passoTutorNome,
        passoTutorTelefone,
        passoEscolherPet,
        passoNomePet,
        {
          id: "especie",
          pular: (r) => r._petSalvo,
          pergunta: (r) => `O ${r.petNome} é que bicho?`,
          tipo: "opcoes",
          opcoes: () => ["Cachorro", "Gato", "Outro"],
        },
        {
          id: "motivo",
          pergunta: () => "Me conta rapidinho o que está acontecendo ou o que precisa (vacina, consulta, retorno…).",
          tipo: "texto",
          placeholder: "Ex.: vacina anual, está mancando…",
          validar: (v) => (v.trim().length >= 3 ? "" : "Escreve pelo menos uma palavra sobre o motivo."),
        },
        passoData("Que dia seria bom pra você? O Dr. Eder confirma a disponibilidade."),
        passoPeriodo,
      ],
      resumo: (r) => [
        ["Pet", `${r.petNome}${r.especie ? " · " + r.especie : ""}`],
        ["Motivo", r.motivo],
        ["Preferência", `${dataBR(r.data)}, ${String(r.periodo || "").toLowerCase()}`],
        ["Tutor", `${r.tutorNome} · ${formatarTelefone(r.tutorTelefone)}`],
      ],
      mensagem: (r) => [
        `Olá, Dr. ${primeiroNome(D.veterinario && D.veterinario.nome) || "Eder"}! Gostaria de marcar um atendimento:`,
        `Pet: ${r.petNome}${r.especie ? " (" + r.especie + ")" : ""}`,
        `Motivo: ${r.motivo}`,
        `Preferência: ${dataBR(r.data)}, ${String(r.periodo || "").toLowerCase()}`,
        `Tutor: ${r.tutorNome}, ${formatarTelefone(r.tutorTelefone)}`,
      ],
      pedido: (r) => ({
        tipo: "veterinario",
        servico: "Consulta veterinária",
        pet: { nome: r.petNome, especie: r.especie || "", porte: r.porte || "" },
        data: r.data,
        periodo: r.periodo,
        itens: r.motivo,
      }),
      fim: "Pronto! Abri o WhatsApp do Dr. Eder com o pedido. É só apertar enviar lá.",
    },

    remedio: {
      titulo: "Medicamentos e produtos",
      destino: () => D.whatsapp,
      passos: [
        {
          id: "animal",
          pergunta: () => "É pra qual animal?",
          tipo: "opcoes",
          opcoes: () => ["Cachorro", "Gato", "Gado", "Cavalo", "Aves", "Outro"],
        },
        {
          id: "item",
          pergunta: () => "Qual medicamento ou produto você precisa? Se não souber o nome, descreve pra que é.",
          tipo: "texto",
          placeholder: "Ex.: vermífugo pra cachorro de 15 kg",
          validar: (v) => (v.trim().length >= 3 ? "" : "Escreve o que você precisa."),
        },
        {
          id: "quantidade",
          pergunta: () => "Quantidade?",
          tipo: "texto",
          placeholder: "Ex.: 2 caixas, 1 frasco…",
          opcional: "Ainda não sei",
        },
        passoData("Quando quer passar pra retirar?", "Assim que tiver"),
        passoTutorSalvo,
        passoTutorNome,
        passoTutorTelefone,
      ],
      resumo: (r) => [
        ["Animal", r.animal],
        ["Pedido", r.item],
        ["Quantidade", r.quantidade],
        ["Retirada", r.data ? dataBR(r.data) : "assim que tiver"],
        ["Cliente", `${r.tutorNome} · ${formatarTelefone(r.tutorTelefone)}`],
      ],
      mensagem: (r) => [
        "Olá! Quero reservar um produto:",
        `Para: ${r.animal}`,
        `Produto: ${r.item}`,
        r.quantidade ? `Quantidade: ${r.quantidade}` : "",
        `Retirada: ${r.data ? dataBR(r.data) : "assim que tiver"}`,
        `Nome: ${r.tutorNome}, ${formatarTelefone(r.tutorTelefone)}`,
        "Vocês têm? Qual o valor?",
      ],
      pedido: (r) => ({
        tipo: "medicamento",
        servico: "Reserva de produto",
        pet: { nome: "", especie: r.animal || "", porte: "" },
        data: r.data || "",
        periodo: "",
        itens: [r.item, r.quantidade].filter(Boolean).join(" · "),
      }),
      fim: "Pronto! Abri o WhatsApp da loja com o pedido. É só apertar enviar lá. A equipe confirma estoque e valor. Se tiver receita, manda a foto na mesma conversa.",
    },
  };

  const MENU = [
    { id: "banho", rotulo: "Agendar banho e tosa" },
    { id: "vet", rotulo: "Consulta com o veterinário" },
    { id: "remedio", rotulo: "Medicamentos e produtos" },
    { id: "whats", rotulo: "Falar direto no WhatsApp" },
  ];

  // ---------- estado ----------
  // estado = { fluxo, i, r: {respostas}, msgs: [{de, html, passo}], fase: 'menu'|'passos'|'confirmar'|'fim', atualizado }
  let estado = carregarRascunho() || novoEstado();

  function novoEstado() {
    return { fluxo: null, i: 0, r: {}, msgs: [], fase: "menu", atualizado: Date.now(), chatId: novoChatId() };
  }

  // Id da conversa: vai no contato salvo no meio do caminho e no pedido final,
  // pro painel saber quem concluiu e quem parou no meio.
  function novoChatId() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  const TIPO_POR_FLUXO = { banho: "banho-tosa", vet: "veterinario", remedio: "medicamento" };

  // Assim que a pessoa deu nome + WhatsApp, avisa o painel (uma vez por conversa).
  // Se ela não confirmar o pedido, a equipe vê no painel e pode chamar pra concluir.
  function registrarContatoSeDer() {
    const r = estado.r;
    if (estado.contatoSalvo || !r.tutorNome || !r.tutorTelefone) return;
    if (!window.AgroStore || typeof window.AgroStore.registrarContato !== "function") return;
    if (!estado.chatId) estado.chatId = novoChatId(); // rascunhos antigos não tinham id
    estado.contatoSalvo = true;
    Promise.resolve(
      window.AgroStore.registrarContato({
        id: estado.chatId,
        tipo: TIPO_POR_FLUXO[estado.fluxo] || estado.fluxo,
        nome: r.tutorNome,
        telefone: soDigitos(r.tutorTelefone),
        pet: r.petNome || "",
      })
    ).catch((e) => {
      estado.contatoSalvo = false; // tenta de novo na próxima resposta
      console.warn("Não deu pra salvar o contato no painel:", e);
    });
  }

  function carregarRascunho() {
    const s = ler(CHAVE_RASCUNHO);
    if (!s || !s.atualizado) return null;
    if (Date.now() - s.atualizado > VALIDADE_RASCUNHO_DIAS * 864e5) {
      apagar(CHAVE_RASCUNHO);
      return null;
    }
    return s;
  }

  function salvar() {
    estado.atualizado = Date.now();
    if (estado.fase === "fim" || (estado.fase === "menu" && !estado.msgs.length)) apagar(CHAVE_RASCUNHO);
    else gravar(CHAVE_RASCUNHO, estado);
    atualizarAviso();
  }

  function temRascunhoAberto() {
    return estado.fluxo && (estado.fase === "passos" || estado.fase === "confirmar");
  }

  // ---------- montagem do DOM ----------
  const raiz = document.createElement("div");
  raiz.className = "achat";
  raiz.innerHTML = `
    <button type="button" class="achat__lancador" aria-expanded="false" aria-controls="achat-painel">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
      <span class="achat__lancador-texto">Agendar</span>
      <span class="achat__aviso" hidden></span>
    </button>
    <section id="achat-painel" class="achat__painel" role="dialog" aria-modal="false" aria-labelledby="achat-titulo" hidden>
      <header class="achat__topo">
        <img class="achat__avatar" src="assets/logo.png" alt="" />
        <div class="achat__topo-texto">
          <strong id="achat-titulo">Agrocampo Mariano</strong>
          <span>Agendamentos e pedidos</span>
        </div>
        <button type="button" class="achat__recomecar" title="Começar de novo">Recomeçar</button>
        <button type="button" class="achat__fechar" aria-label="Fechar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </header>
      <div class="achat__mensagens" aria-live="polite"></div>
      <div class="achat__entrada"></div>
    </section>
  `;

  const lancador = raiz.querySelector(".achat__lancador");
  const aviso = raiz.querySelector(".achat__aviso");
  const painel = raiz.querySelector(".achat__painel");
  const caixaMsgs = raiz.querySelector(".achat__mensagens");
  const caixaEntrada = raiz.querySelector(".achat__entrada");

  lancador.addEventListener("click", () => (painel.hidden ? abrir() : fechar()));
  raiz.querySelector(".achat__fechar").addEventListener("click", fechar);
  raiz.querySelector(".achat__recomecar").addEventListener("click", () => {
    estado = novoEstado();
    salvar();
    iniciarMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !painel.hidden) fechar();
  });

  function abrir(fluxoId) {
    painel.hidden = false;
    raiz.classList.add("achat--aberto");
    lancador.setAttribute("aria-expanded", "true");
    if (fluxoId && FLUXOS[fluxoId] && !(temRascunhoAberto() && estado.fluxo === fluxoId)) {
      estado = novoEstado();
      desenharTudo();
      escolherFluxo(fluxoId, MENU.find((m) => m.id === fluxoId).rotulo);
      return;
    }
    if (!estado.msgs.length) iniciarMenu();
    else desenharTudo();
  }

  function fechar() {
    painel.hidden = true;
    raiz.classList.remove("achat--aberto");
    lancador.setAttribute("aria-expanded", "false");
    lancador.focus();
  }

  function atualizarAviso() {
    const aberto = temRascunhoAberto();
    aviso.hidden = !aberto;
    aviso.textContent = aberto ? "1" : "";
    lancador.setAttribute(
      "aria-label",
      aberto ? "Continuar seu agendamento" : "Abrir chat de agendamento"
    );
  }

  // ---------- mensagens ----------
  function addMsg(de, html) {
    estado.msgs.push({ de, html, passo: estado.fase === "passos" ? estado.i : -1 });
    desenharMsg(estado.msgs[estado.msgs.length - 1]);
  }

  function desenharMsg(m) {
    const el = document.createElement("div");
    el.className = "achat__msg achat__msg--" + m.de;
    el.innerHTML = m.html;
    caixaMsgs.appendChild(el);
    caixaMsgs.scrollTop = caixaMsgs.scrollHeight;
  }

  function desenharTudo() {
    caixaMsgs.innerHTML = "";
    estado.msgs.forEach(desenharMsg);
    desenharEntrada();
  }

  // ---------- fluxo ----------
  function iniciarMenu() {
    estado.fase = "menu";
    caixaMsgs.innerHTML = "";
    const p = perfil();
    const ola = p.nome ? `Oi, ${escapar(primeiroNome(p.nome))}!` : "Oi!";
    addMsg("bot", `${ola} Por aqui você agenda banho e tosa, marca consulta com o veterinário ou reserva medicamentos. O que vai ser?`);
    salvar();
    desenharEntrada();
  }

  function escolherFluxo(id, rotulo) {
    addMsg("eu", escapar(rotulo));
    if (id === "whats") {
      window.open("https://wa.me/" + D.whatsapp, "_blank", "noopener");
      addMsg("bot", "Abri o WhatsApp da loja numa nova aba.");
      salvar();
      desenharEntrada();
      return;
    }
    estado.fluxo = id;
    estado.fase = "passos";
    estado.i = -1;
    estado.r = {};
    avancar();
  }

  function fluxo() {
    return FLUXOS[estado.fluxo];
  }

  function passoAtual() {
    return fluxo().passos[estado.i];
  }

  function avancar() {
    const passos = fluxo().passos;
    let i = estado.i + 1;
    while (i < passos.length && passos[i].pular && passos[i].pular(estado.r)) i++;
    estado.i = i;
    if (i >= passos.length) {
      mostrarResumo();
      return;
    }
    addMsg("bot", escapar(passos[i].pergunta(estado.r)));
    salvar();
    desenharEntrada();
  }

  function responder(valor, exibicao) {
    const passo = passoAtual();
    addMsg("eu", escapar(exibicao != null ? exibicao : valor));
    estado.r[passo.id] = valor;
    if (passo.aoResponder) passo.aoResponder(valor, estado.r);
    registrarContatoSeDer();
    avancar();
  }

  function voltar() {
    if (estado.fase === "confirmar") {
      estado.fase = "passos";
      estado.i = fluxo().passos.length; // volta pro último passo respondido abaixo
    }
    const passos = fluxo().passos;
    let i = estado.i - 1;
    while (i >= 0 && passos[i].pular && passos[i].pular(estado.r)) i--;
    if (i < 0) {
      estado = novoEstado();
      salvar();
      iniciarMenu();
      return;
    }
    // remove as mensagens a partir da pergunta do passo i
    const corte = estado.msgs.findIndex((m) => m.passo >= i && m.de === "bot");
    if (corte >= 0) estado.msgs = estado.msgs.slice(0, corte);
    // apaga as respostas dadas do passo i em diante (ex.: trocou cachorro por gato → porte some).
    // Passos pulados mantêm o valor, porque foram preenchidos pelo perfil salvo.
    const respondidos = passos.slice(i).filter((p) => !(p.pular && p.pular(estado.r)));
    respondidos.forEach((p) => delete estado.r[p.id]);
    estado.i = i - 1;
    caixaMsgs.innerHTML = "";
    estado.msgs.forEach(desenharMsg);
    avancar();
  }

  function mostrarResumo() {
    estado.fase = "confirmar";
    const linhas = fluxo()
      .resumo(estado.r)
      .filter(([, v]) => v)
      .map(([k, v]) => `<dt>${escapar(k)}</dt><dd>${escapar(v)}</dd>`)
      .join("");
    addMsg("bot", `Confere se está tudo certo:<dl class="achat__resumo">${linhas}</dl>`);
    salvar();
    desenharEntrada();
  }

  function confirmar() {
    const f = fluxo();
    const r = estado.r;
    const texto = f.mensagem(r).filter(Boolean).join("\n");
    const destino = f.destino();

    const pedido = Object.assign(
      {
        tutor: { nome: r.tutorNome, telefone: soDigitos(r.tutorTelefone) },
        observacoes: r.obs || "",
        criadoEm: new Date().toISOString(),
        origem: "chat",
        chatId: estado.chatId || "",
      },
      f.pedido(r)
    );

    try {
      if (window.AgroStore && typeof window.AgroStore.salvarAgendamento === "function") {
        Promise.resolve(window.AgroStore.salvarAgendamento(pedido)).catch((e) =>
          console.warn("Não deu pra salvar o pedido no painel:", e)
        );
      }
    } catch (e) {
      console.warn("Não deu pra salvar o pedido no painel:", e);
    }

    window.open(`https://wa.me/${destino}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");

    atualizarPerfil(r);
    addMsg("eu", "Confirmar e enviar");
    addMsg("bot", escapar(f.fim));
    estado.fase = "fim";
    salvar();
    desenharEntrada();
  }

  // ---------- área de resposta ----------
  function botao(rotulo, classe, acao) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "achat__opcao" + (classe ? " " + classe : "");
    b.textContent = rotulo;
    b.addEventListener("click", acao);
    return b;
  }

  function linhaVoltar() {
    const b = botao("← Voltar", "achat__opcao--voltar", voltar);
    return b;
  }

  function desenharEntrada() {
    desenharEntradaSemRolar();
    // a área de resposta muda de altura: garante que a última pergunta fica visível
    caixaMsgs.scrollTop = caixaMsgs.scrollHeight;
  }

  function desenharEntradaSemRolar() {
    caixaEntrada.innerHTML = "";

    if (estado.fase === "menu") {
      const grade = document.createElement("div");
      grade.className = "achat__opcoes achat__opcoes--menu";
      MENU.forEach((m) => grade.appendChild(botao(m.rotulo, "", () => escolherFluxo(m.id, m.rotulo))));
      caixaEntrada.appendChild(grade);
      return;
    }

    if (estado.fase === "fim") {
      const grade = document.createElement("div");
      grade.className = "achat__opcoes";
      grade.appendChild(
        botao("Fazer outro pedido", "", () => {
          estado = novoEstado();
          iniciarMenu();
        })
      );
      caixaEntrada.appendChild(grade);
      return;
    }

    if (estado.fase === "confirmar") {
      const grade = document.createElement("div");
      grade.className = "achat__opcoes";
      grade.appendChild(botao("Confirmar e enviar", "achat__opcao--principal", confirmar));
      grade.appendChild(linhaVoltar());
      caixaEntrada.appendChild(grade);
      return;
    }

    const passo = passoAtual();
    if (!passo) return;

    if (passo.tipo === "opcoes") {
      const grade = document.createElement("div");
      grade.className = "achat__opcoes";
      passo.opcoes(estado.r).forEach((o) => grade.appendChild(botao(o, "", () => responder(o))));
      grade.appendChild(linhaVoltar());
      caixaEntrada.appendChild(grade);
      return;
    }

    // texto, telefone ou data
    const form = document.createElement("form");
    form.className = "achat__form";
    const campo = document.createElement(passo.tipo === "data" ? "select" : "input");
    campo.className = "achat__campo";
    if (passo.tipo === "data") {
      // Lista de dias (sem ano): hoje + próximas 2 semanas, sem domingos (loja fechada).
      const vazio = document.createElement("option");
      vazio.value = "";
      vazio.textContent = "Escolha o dia";
      campo.appendChild(vazio);
      for (let d = 0; d < 14; d++) {
        const iso = somarDiasISO(d);
        if (diaDaSemana(iso) === 0) continue;
        const o = document.createElement("option");
        o.value = iso;
        o.textContent = d === 0 ? `Hoje, ${dataBR(iso)}` : d === 1 ? `Amanhã, ${dataBR(iso)}` : dataBR(iso);
        campo.appendChild(o);
      }
    } else if (passo.tipo === "telefone") {
      campo.type = "tel";
      campo.inputMode = "tel";
      campo.autocomplete = "tel";
    } else {
      campo.type = "text";
      if (passo.id === "tutorNome") campo.autocomplete = "name";
    }
    campo.placeholder = passo.placeholder || "";
    campo.setAttribute("aria-label", passo.pergunta(estado.r));

    // rascunho do que está sendo digitado também fica salvo
    const chaveDigitando = "_digitando_" + passo.id;
    if (estado.r[chaveDigitando]) campo.value = estado.r[chaveDigitando];
    campo.addEventListener("input", () => {
      estado.r[chaveDigitando] = campo.value;
      salvar();
    });

    const enviar = document.createElement("button");
    enviar.type = "submit";
    enviar.className = "achat__enviar";
    enviar.setAttribute("aria-label", "Enviar");
    enviar.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const erro = document.createElement("p");
    erro.className = "achat__erro";
    erro.setAttribute("role", "alert");

    form.appendChild(campo);
    form.appendChild(enviar);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = campo.value.trim();
      const msgErro = passo.validar ? passo.validar(v) : v ? "" : "Escreve alguma coisa ou escolhe uma opção.";
      if (msgErro) {
        erro.textContent = msgErro;
        campo.focus();
        return;
      }
      delete estado.r[chaveDigitando];
      if (passo.tipo === "data") responder(v, dataBR(v));
      else if (passo.tipo === "telefone") responder(soDigitos(v), formatarTelefone(v));
      else responder(v);
    });

    caixaEntrada.appendChild(form);
    caixaEntrada.appendChild(erro);

    const extras = document.createElement("div");
    extras.className = "achat__opcoes achat__opcoes--extras";
    if (passo.opcional) {
      extras.appendChild(
        botao(passo.opcional, "", () => {
          delete estado.r[chaveDigitando];
          const p = passoAtual();
          addMsg("eu", escapar(passo.opcional));
          estado.r[p.id] = "";
          avancar();
        })
      );
    }
    extras.appendChild(linhaVoltar());
    caixaEntrada.appendChild(extras);

    if (!painel.hidden && window.matchMedia("(pointer: fine)").matches) campo.focus();
  }

  // ---------- inicialização ----------
  function montar() {
    document.body.appendChild(raiz);
    atualizarAviso();
    // o botão verde antigo de WhatsApp sai de cena: o chat já tem a opção de falar no WhatsApp
    const antigo = document.getElementById("whatsapp-flutuante");
    if (antigo) antigo.style.display = "none";
  }

  window.AgroChat = { abrir, fechar };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montar);
  else montar();
})();
