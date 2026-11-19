(function () {
  "use strict";

  let dados = DADOS_AGROCAMPO;

  function formatarPreco(preco) {
    if (preco === null || preco === undefined) return "Consulte o preço";
    return preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatarTelefoneExibicao(numero) {
    // numero no formato "554836327929" (DDI + DDD + número)
    const ddi = numero.slice(0, 2);
    const ddd = numero.slice(2, 4);
    const resto = numero.slice(4);
    const parte1 = resto.slice(0, resto.length - 4);
    const parte2 = resto.slice(-4);
    return `+${ddi} ${ddd} ${parte1}-${parte2}`;
  }

  function renderizarInfoBasica() {
    document.getElementById("marca-nome").textContent = dados.nome;
    document.getElementById("footer-nome").textContent = dados.nome;
    document.getElementById("footer-endereco").textContent = dados.endereco;
    document.getElementById("footer-horario").textContent = dados.horario;

    const linkWhats = "https://wa.me/" + dados.whatsapp;
    document.getElementById("footer-whatsapp").href = linkWhats;
    document.getElementById("footer-whatsapp").textContent =
      "WhatsApp: " + formatarTelefoneExibicao(dados.whatsapp);
    document.getElementById("whatsapp-flutuante").href = linkWhats;

    const linkInsta = dados.instagram.startsWith("@")
      ? "https://instagram.com/" + dados.instagram.slice(1)
      : "#";
    document.getElementById("footer-instagram").href = linkInsta;
    document.getElementById("footer-instagram").textContent =
      "Instagram: " + dados.instagram;

    document.getElementById("footer-email").href = "mailto:" + dados.email;
    document.getElementById("footer-email").textContent = "Email: " + dados.email;
  }

  function renderizarVeterinario() {
    const vet = dados.veterinario;
    if (!vet) return;

    document.getElementById("veterinario-nome").textContent = vet.nome;
    document.getElementById("veterinario-cargo").textContent = vet.cargo || "";
    document.getElementById("veterinario-experiencia").textContent = vet.experiencia || "";

    const fotoEl = document.getElementById("veterinario-foto");
    if (vet.foto) {
      fotoEl.innerHTML = `<img src="${vet.foto}" alt="${vet.nome}" />`;
    }

    const linkWhatsVet = "https://wa.me/" + vet.whatsapp;
    const whatsappEl = document.getElementById("veterinario-whatsapp");
    whatsappEl.href = linkWhatsVet;
    whatsappEl.textContent =
      "Falar no WhatsApp: " + formatarTelefoneExibicao(vet.whatsapp);

    const linkInstaVet = vet.instagram.startsWith("@")
      ? "https://instagram.com/" + vet.instagram.slice(1)
      : "#";
    const instaEl = document.getElementById("veterinario-instagram");
    instaEl.href = linkInstaVet;
    instaEl.textContent = "Instagram: " + vet.instagram;
  }

  function renderizarProdutos() {
    const grid = document.getElementById("produtos-grid");
    grid.innerHTML = dados.produtos
      .map(
        (p) => `
        <div class="produto-card">
          <div class="produto-card__imagem">Foto do produto</div>
          <div class="produto-card__corpo">
            <div class="produto-card__categoria">${p.categoria}</div>
            <div class="produto-card__nome">${p.nome}</div>
            <div class="produto-card__preco">${formatarPreco(p.preco)}</div>
          </div>
        </div>`
      )
      .join("");
  }

  function renderizarServicos() {
    const grid = document.getElementById("servicos-grid");
    grid.innerHTML = dados.servicos
      .map(
        (s) => `
        <a class="servico-card" href="#" data-whatsapp data-servico="${s.nome}" target="_blank" rel="noopener">
          <h3>${s.nome}</h3>
          <p>Clique e agende seu horário</p>
        </a>`
      )
      .join("");
  }

  function renderizarResultados() {
    const rolo = document.getElementById("resultados-rolo");
    if (!rolo || !dados.resultados) return;

    // Com poucas fotos o rolo não passaria da largura da tela e não rolaria:
    // repete a lista até ter o suficiente pra rolagem contínua.
    let lista = dados.resultados;
    while (lista.length > 0 && lista.length < 10) {
      lista = lista.concat(dados.resultados);
    }

    rolo.innerHTML = lista
      .map(
        (r) => `
        <div class="resultado-card">
          <div class="resultado-card__foto">
            ${r.imagem ? `<img src="${r.imagem}" alt="Animal atendido na Agrocampo" />` : "📷 Foto em breve"}
          </div>
        </div>`
      )
      .join("");
  }

  function configurarRoloResultados() {
    const rolo = document.getElementById("resultados-rolo");
    if (!rolo) return;

    const velocidade = 0.6; // px por frame — ritmo de vitrine, contínuo

    function passo() {
      const fimDoRolo = rolo.scrollWidth - rolo.clientWidth;
      if (rolo.scrollLeft >= fimDoRolo - 1) {
        rolo.scrollLeft = 0; // chegou no fim, volta pro começo e continua
      } else {
        rolo.scrollLeft += velocidade;
      }
      requestAnimationFrame(passo);
    }

    requestAnimationFrame(passo);
  }

  // Agendamento é só pelo chat do botão verde (js/chatbot.js). Os botões
  // "Agendar" e os cartões de serviço abrem esse chat. Se ele não carregar,
  // o link cai no WhatsApp da loja com uma mensagem pronta.
  function linkWhatsAgendamento(servico) {
    const texto = servico
      ? `Olá! Gostaria de agendar ${servico.toLowerCase()} no ${dados.nome}.`
      : `Olá! Gostaria de agendar banho e tosa no ${dados.nome}.`;
    return `https://wa.me/${dados.whatsapp}?text=${encodeURIComponent(texto)}`;
  }

  function configurarBotoesAgendar() {
    document.querySelectorAll("[data-whatsapp]").forEach(function (el) {
      el.href = linkWhatsAgendamento(el.dataset.servico);
      el.addEventListener("click", function (evento) {
        if (window.AgroChat && typeof window.AgroChat.abrir === "function") {
          evento.preventDefault();
          window.AgroChat.abrir("banho");
        }
      });
    });
  }

  const reduzirMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Elementos que surgem ao rolar. Grupos (cards, colunas) entram em cascata.
  const ALVOS_REVELAR = [
    { seletor: ".numeros__titulo" },
    { seletor: ".num-card", cascata: true },
    { seletor: ".bloco > .container > .eyebrow, .bloco__titulo, .bloco__subtitulo", cascata: true },
    { seletor: ".produto-card", cascata: true },
    { seletor: ".servico-card", cascata: true },
    { seletor: ".resultados" },
    { seletor: ".bloco__acao" },
    { seletor: ".dividida__escuro", suave: true },
    { seletor: ".dividida__creme > *", cascata: true },
    { seletor: ".rodape__grid > *", cascata: true },
  ];

  function configurarRevelar() {
    if (reduzirMovimento || !("IntersectionObserver" in window)) return;

    const observador = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (entrada) {
          if (!entrada.isIntersecting) return;
          const el = entrada.target;
          el.classList.add("revelado");
          observador.unobserve(el);

          // Depois que entrou, devolve o elemento ao estado normal pra não
          // atrapalhar os efeitos de hover dos cards.
          el.addEventListener("transitionend", function limpar(ev) {
            if (ev.target !== el || ev.propertyName !== "opacity") return;
            el.classList.remove("revelar", "revelar--suave", "revelado");
            el.style.transitionDelay = "";
            el.removeEventListener("transitionend", limpar);
          });
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );

    ALVOS_REVELAR.forEach(function (alvo) {
      const elementos = document.querySelectorAll(alvo.seletor);
      const contadorPorPai = new Map();

      elementos.forEach(function (el) {
        if (el.classList.contains("revelar")) return;
        el.classList.add("revelar");
        if (alvo.suave) el.classList.add("revelar--suave");

        if (alvo.cascata) {
          const pai = el.parentElement;
          const indice = contadorPorPai.get(pai) || 0;
          contadorPorPai.set(pai, indice + 1);
          el.style.transitionDelay = Math.min(indice * 110, 550) + "ms";
        }

        observador.observe(el);
      });
    });
  }

  // Números dourados: contam de 0 até o valor quando aparecem na tela.
  function configurarContadores() {
    const numeros = document.querySelectorAll("[data-contar]");
    if (!numeros.length) return;

    function textoFinal(el) {
      return (el.dataset.prefixo || "") + el.dataset.contar;
    }

    if (reduzirMovimento || !("IntersectionObserver" in window)) {
      numeros.forEach(function (el) { el.textContent = textoFinal(el); });
      return;
    }

    const duracao = 1800;
    const suavizar = function (t) { return 1 - Math.pow(1 - t, 3); };

    function contar(el) {
      const alvo = Number(el.dataset.contar);
      const prefixo = el.dataset.prefixo || "";
      const inicio = performance.now();

      function quadro(agora) {
        const progresso = Math.min((agora - inicio) / duracao, 1);
        el.textContent = prefixo + Math.round(alvo * suavizar(progresso));
        if (progresso < 1) requestAnimationFrame(quadro);
      }
      requestAnimationFrame(quadro);
    }

    const observador = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (entrada) {
          if (!entrada.isIntersecting) return;
          observador.unobserve(entrada.target);
          // pequeno atraso pra começar junto com a entrada do card
          setTimeout(function () { contar(entrada.target); }, 250);
        });
      },
      { threshold: 0.6 }
    );

    numeros.forEach(function (el) {
      el.textContent = (el.dataset.prefixo || "") + "0";
      observador.observe(el);
    });
  }

  document.addEventListener("DOMContentLoaded", async function () {
    // Conta o acesso pro painel (1 por sessão do navegador). Não espera nem trava o site.
    if (window.AgroStore && window.AgroStore.registrarVisita) window.AgroStore.registrarVisita();

    // Dados salvos pelo painel admin (js/store.js); se falhar, fica com o dados.js.
    try {
      if (window.AgroStore) dados = await window.AgroStore.carregarDados();
    } catch (e) { /* segue com o padrão */ }
    renderizarInfoBasica();
    renderizarProdutos();
    renderizarServicos();
    renderizarResultados();
    configurarRoloResultados();
    renderizarVeterinario();
    configurarBotoesAgendar();
    configurarRevelar();
    configurarContadores();
  });
})();
