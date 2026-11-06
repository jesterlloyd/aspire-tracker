-- IMPORT-ROW-COHORT-1 (Owner, 2026-11-05): 27 Fall 2025 interns were imported by Keith from
-- Student Profiles while Spring 2026 was open, and the import filed every row into the open
-- cohort. This creates the Fall 2025 internship cohort (a past cohort, Completed, real) when it
-- is missing, and moves exactly those 27 students into it. They have no placements, unit
-- assignments, residency candidate rows or sent emails, so nothing else points at Spring 2026.
-- One transaction; it refuses to run unless all 27 are still in Spring 2026.
begin;

insert into cohorts (name, status)
select 'Fall 2025', 'Completed'
where not exists (select 1 from cohorts where lower(name) = 'fall 2025' and not is_demo);

do $$
declare
  ids uuid[] := array[
    '466ebae3-b538-4d12-b167-4a7d821b6eec',
    '30b8978b-c403-4e76-9d28-a96b806da652',
    'b4134c2e-421d-4c0e-af52-ef416f51dd19',
    '8161d3f6-2458-42a4-bade-0ba362bd7c6f',
    'f1bca93e-5adb-4c27-8d8f-008b70ef6305',
    '9625a406-3b1f-42e6-8da3-920aa6c6456e',
    '16286a91-d74c-4960-9b87-97387e4decbc',
    'a45b181d-85ed-4dfe-bf37-220cb99e3de1',
    '76dc56e2-7eaf-413e-8b9b-23864035a805',
    '8b791720-c5c3-4d3d-80d8-632bc52cb6ee',
    'f8cd169a-d902-4bc6-be31-a66462b1e2ef',
    '2ba783b8-152c-4ddc-81cf-4ea1cf275315',
    'bf1d8f80-0d9a-46c0-a26b-e4855c8a0f0f',
    '049b35e6-2e19-44c1-aa45-b9df24ea83c9',
    '68231b0e-8027-43da-b732-286c10d4c99f',
    '334235d8-f8b8-4797-a9c0-db29c52e7292',
    'a16e8c29-407b-4e1d-af32-c0c2b48b20f9',
    '895ec89a-ec6d-439e-acb2-e390906224f1',
    '9a8de089-cc19-4efb-9e5d-57e33d5447bb',
    'acf45229-ec7f-45fb-bbe6-adeee034e437',
    'c50f35c3-925e-49b3-a432-4841bc3117f2',
    'd6e2a869-3043-4829-89ce-6df3715e8dc1',
    'b2bdbdbc-3f4e-4b58-b9a0-9cd2d86e6daa',
    '22060eea-9631-4604-8214-e75a3d755f2b',
    '1d8bc4bf-cf28-4e24-bf98-8abcc2ddabc5',
    'dd0c2027-6e4c-4388-920f-abff00f4dcc6',
    'eaf055d3-927f-432d-a59c-db10def20a69'
  ];
  fall uuid;
  n int;
begin
  select id into fall from cohorts where lower(name) = 'fall 2025' and not is_demo limit 1;
  select count(*) into n from students
   where id = any(ids) and cohort_id = '802e3b9c-b227-4cc4-8b9f-18526ffdb070' and not is_demo;
  if n <> 27 then raise exception 'expected 27 students in Spring 2026, found %', n; end if;
  update students set cohort_id = fall, aspire_cohort = 'Fall 2025' where id = any(ids);
end $$;

-- POST
select c.name, count(*) from students s join cohorts c on c.id = s.cohort_id
 where s.id in (select id from students where created_at between '2026-11-06 01:29' and '2026-11-06 01:32')
 group by 1;

commit;
