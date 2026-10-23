-- AKK Hub — wallet passes were dropped: remove the wallet data function. Idempotent.
drop function if exists core.my_card_wallet(text, text);
