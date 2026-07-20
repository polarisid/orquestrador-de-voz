-- Triagem por voz — Smart Center Aracaju
-- Executar no Supabase (SQL Editor)

create table if not exists chamadas_triagem (
  id uuid primary key default gen_random_uuid(),
  os_numero text not null,
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

create index on chamadas_triagem (os_numero);
create index on chamadas_triagem (status);
create index on chamadas_triagem (criada_em desc);

create table if not exists uploads_os (
  id uuid primary key default gen_random_uuid(),
  chamada_id uuid references chamadas_triagem(id) on delete cascade,
  os_numero text not null,
  token text unique not null,
  documentos_exigidos text[] not null,
  documentos_recebidos jsonb default '[]'::jsonb,
  expira_em timestamptz default now() + interval '7 days',
  criado_em timestamptz default now()
);

create index on uploads_os (token);

-- RLS: service_role escreve; o portal de upload lê só pelo token.
alter table chamadas_triagem enable row level security;
alter table uploads_os enable row level security;
