-- A note per place inside a list: why it is on this list, what to order.
-- Lists double as shortlists the assistant builds ("solo dinners to try in
-- November"); without this the reasoning stays behind in the chat.

alter table public.list_places add column note text;
