/*
 * CONFIGURAÇÃO DO BANCO DE DADOS (Supabase)
 *
 * Os dados do site (produtos, serviços, fotos), os pedidos dos clientes e o
 * painel /admin/ ficam no Supabase. A chave "anon" abaixo é feita pra ficar
 * pública — a segurança vem das regras (RLS) criadas pelo SQL em
 * admin/LEIA-ME.md. NUNCA cole aqui a chave "service_role" / secret.
 *
 * Cada funcionário entra no painel com o próprio e-mail e senha, cadastrados
 * em Supabase → Authentication → Users.
 */
window.AGRO_CONFIG = {
  supabaseUrl: "https://rmeuegrdblgvqtlkkdxt.supabase.co",
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtZXVlZ3JkYmxndnF0bGtrZHh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMDIxOTYsImV4cCI6MjExMDY3ODE5Nn0.SbgBF5Z-scq3k3_uPmwPJfuZ9Knd0Gvv_YOjl42ZVrY",
};
