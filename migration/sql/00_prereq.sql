-- AKK Hub — prerequisites in the new project (safe to run more than once).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
-- Site Progress sends push through pg_net (functions live in schema "net").
create extension if not exists pg_net with schema extensions;

create schema if not exists core;
grant usage on schema core to anon, authenticated, service_role;
