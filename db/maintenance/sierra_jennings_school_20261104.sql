-- STUDENT-IMPORT-KEITH-1 follow-up (Owner, 2026-11-04): Sierra Jennings' school was the campus-less
-- "West Coast University"; her intake row says "WCU - North Hollywood", the campus her Spring 2026
-- classmates carry. The import kept the old value (Update keeps a conflicting value).
-- Undo: UPDATE public.students SET school = 'West Coast University' WHERE id = '11eff302-7b6f-43da-9275-1036794450aa';
UPDATE public.students
   SET school = 'West Coast University North Hollywood'
 WHERE id = '11eff302-7b6f-43da-9275-1036794450aa'
   AND school = 'West Coast University'
RETURNING id, school;
