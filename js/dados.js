/*
 * DADOS DO NEGÓCIO — edite este arquivo pra atualizar o site.
 * Troque os placeholders (marcados com "PLACEHOLDER") pelos dados reais
 * assim que o cliente enviar (logo, produtos, endereço, horário).
 */

const DADOS_AGROCAMPO = {
  nome: "Agrocampo Mariano",
  whatsapp: "554836327929", // +55 48 3632-7929
  endereco: "Rua Silvio Búrigo, 1087, Monte Castelo, Tubarão/SC",
  horario: "Seg a Sex: 8h30 às 18h (pausa das 12h às 13h30) · Sáb: 8h às 12h · Dom: fechado",
  instagram: "@agrocampomariano",
  email: "agrocampotubarao@gmail.com",

  // Veterinário parceiro — contato separado do WhatsApp da loja
  veterinario: {
    nome: "Eder Mota Mariano",
    cargo: "Médico Veterinário",
    experiencia: "Mais de 10 anos de experiência",
    foto: "assets/vet-eder.jpg",
    whatsapp: "554899423631", // +55 48 9942-3631
    instagram: "@eder.motam",
  },

  // Serviços de banho e tosa oferecidos
  servicos: [
    { id: "banho", nome: "Banho" },
    { id: "tosa", nome: "Tosa" },
    { id: "banho-tosa", nome: "Banho + Tosa" },
  ],

  // Rolo de fotos dos pets depois do banho e tosa. Pra adicionar mais,
  // salve a foto em assets/ e inclua uma linha aqui (imagem: null = "Foto em breve").
  resultados: [
    { imagem: "assets/pet1.jpeg" },
    { imagem: "assets/pet2.jpeg" },
    { imagem: "assets/pet3.jpeg" },
    { imagem: "assets/pet4.jpeg" },
  ],

  // Catálogo de produtos — PLACEHOLDER até o cliente enviar a lista real.
  // Cada produto: nome, categoria, preço (opcional), imagem (opcional).
  produtos: [
    {
      nome: "Ração Premium Cães Adultos",
      categoria: "Ração",
      preco: null,
      imagem: "assets/produto-placeholder.svg",
    },
    {
      nome: "Ração Premium Gatos",
      categoria: "Ração",
      preco: null,
      imagem: "assets/produto-placeholder.svg",
    },
    {
      nome: "Brinquedo Mordedor",
      categoria: "Acessórios",
      preco: null,
      imagem: "assets/produto-placeholder.svg",
    },
    {
      nome: "Shampoo para cães e gatos",
      categoria: "Higiene",
      preco: null,
      imagem: "assets/produto-placeholder.svg",
    },
    {
      nome: "Coleira Ajustável",
      categoria: "Acessórios",
      preco: null,
      imagem: "assets/produto-placeholder.svg",
    },
    {
      nome: "Caminha Confortável",
      categoria: "Conforto",
      preco: null,
      imagem: "assets/produto-placeholder.svg",
    },
  ],
};
