-- =============================================================
-- Camada de voz — Smart Center Aracaju
--
-- TUDO fica no schema "voz", isolado do "public". Nenhuma tabela
-- existente do seu projeto e tocada: este arquivo so cria coisas
-- novas, nunca faz drop nem alter no que ja existe.
--
-- Depois de rodar, va em Settings > API > Exposed schemas e
-- adicione "voz" — senao o PostgREST nao enxerga as tabelas.
--
-- Executar no SQL Editor do Supabase.
-- =============================================================

create schema if not exists voz;

create table if not exists voz.chamadas_triagem (
  id uuid primary key default gen_random_uuid(),
  os_numero text not null,
  fluxo text not null default 'triagem',
  dados jsonb default '{}'::jsonb,   -- campos do formulário do fluxo
  provider_call_id text unique,   -- conversation_id da ElevenLabs
  sip_call_id text,
  telefone text not null,

  produto_modelo text,
  produto_linha text,
  sintoma_declarado text,
  garantia text default 'a_confirmar',

  -- cadastro: o que estava na OS vs o que o cliente confirmou
  cadastro_nome_original text,
  cadastro_endereco_original text,
  cadastro_nome text,
  cadastro_endereco text,
  cadastro_cep text,
  cadastro_referencia text,
  restricao_horario text,
  cadastro_corrigido boolean default false,

  -- sintoma
  sintoma_confirmado text,
  sintoma_inicio text,
  sintoma_frequencia text,
  sintoma_fatores text[],
  codigo_erro text,
  codigo_erro_descricao text,
  divergiu_abertura boolean,
  roteiro_customizado boolean default false,
  triagem_analise jsonb,

  -- confirmação de visita
  agendamento_confirmado boolean,
  agendamento_nova_preferencia text,
  agendamento_motivo text,

  -- retirada
  retirada_quem text,
  retirada_titular boolean,
  retirada_previsao text,

  -- documentação
  doc_canal text,
  doc_telefone text,
  doc_enviado_em timestamptz,

  -- controle
  etapa text default 'abertura',
  -- pendente | discando | em_andamento | concluida | parcial | transferida
  -- | reagendar | sem_contato | cliente_desligou | recusou_gravacao
  -- | nao_e_o_titular | encerrada_pelo_operador
  status text default 'pendente',
  tentativas int default 0,
  ultimo_resultado text,
  transferencia_motivo text,
  observacao text,
  duracao_segundos int,
  gravacao_url text,
  transcricao jsonb,
  resumo text,

  criada_em timestamptz default now(),
  atendida_em timestamptz,
  revisada_em timestamptz,
  finalizada_em timestamptz
);

create index on voz.chamadas_triagem (os_numero);
create index on voz.chamadas_triagem (status);
create index on voz.chamadas_triagem (criada_em desc);

create table if not exists voz.uploads_os (
  id uuid primary key default gen_random_uuid(),
  chamada_id uuid references voz.chamadas_triagem(id) on delete cascade,
  os_numero text not null,
  token text unique not null,
  documentos_exigidos text[] not null,
  documentos_recebidos jsonb default '[]'::jsonb,
  expira_em timestamptz default now() + interval '7 days',
  criado_em timestamptz default now()
);

create index on voz.uploads_os (token);

-- RLS: service_role escreve; o portal de upload lê só pelo token.
alter table voz.chamadas_triagem enable row level security;
alter table voz.uploads_os enable row level security;


-- Configuração editável pelo painel (transbordo, e o que vier depois).
create table if not exists voz.config (
  id uuid primary key default gen_random_uuid(),
  chave text unique not null,
  valor text,
  atualizado_em timestamptz default now()
);

alter table voz.config enable row level security;

-- Fila de discagem.
-- status: pendente | discada | concluida | sem_contato | falhou | cancelada | arquivada
create table if not exists voz.fila (
  id uuid primary key default gen_random_uuid(),
  fluxo text not null,
  dados jsonb not null,
  status text not null default 'pendente',
  tentativas int default 0,
  chamada_id uuid,
  proxima_em timestamptz,
  ultima_em timestamptz,
  finalizada_em timestamptz,
  erro text,
  criada_em timestamptz default now()
);

create index on voz.fila (status);
create index on voz.fila (criada_em);

alter table voz.fila enable row level security;

-- Roteiros editados pelo painel. Um por fluxo; vazio significa usar o padrão.
create table if not exists voz.roteiros (
  id uuid primary key default gen_random_uuid(),
  fluxo text unique not null,
  texto text,
  salvo_em timestamptz
);

alter table voz.roteiros enable row level security;

-- O service_role (usado pelo orquestrador) ignora RLS.
-- Estas concessoes existem para o PostgREST alcancar o schema.
grant usage on schema voz to service_role;
grant all on all tables in schema voz to service_role;
grant all on all sequences in schema voz to service_role;
alter default privileges in schema voz grant all on tables to service_role;
