-- Run AFTER unit_response_system.sql
-- ============================================
-- UNIT LEADERS SEED DATA
-- ============================================
-- NOTE: unit_name values here must match the unit_name values used in the
-- units table (sourced from the /unit-form dropdown in constants.js).
-- Run the orphan check after seeding:
--   SELECT DISTINCT ul.unit_name
--   FROM unit_leaders ul
--   LEFT JOIN units u ON LOWER(TRIM(u.unit_name)) = LOWER(TRIM(ul.unit_name))
--   WHERE u.id IS NULL;
-- If rows are returned, resolve the name mismatch before the form routing
-- can auto-populate CC recipients from unit_leaders.
-- ============================================

INSERT INTO unit_leaders (unit_name, full_name, email, role, role_qualifier, is_primary_lead) VALUES
-- ACU/CDU
('ACU/CDU', 'Jocelyn Uy', 'Jocelyn.Uy@cshs.org', 'Associate Director', NULL, true),
('ACU/CDU', 'Audi Bugayong', 'Audimar.Bugayong@cshs.org', 'Assistant Nurse Manager', NULL, false),
('ACU/CDU', 'Ryan Trias', 'Ryan.Trias@cshs.org', 'NPD Practitioner', NULL, false),

-- Emergency Department (not aspire_eligible by default)
('Emergency Department', 'Sharon Braun', 'sharon.braun@cshs.org', 'Associate Director', NULL, true),
('Emergency Department', 'Priscilla Babila', 'Pamelapriscilla.Babila@cshs.org', 'Assistant Nurse Manager', NULL, false),
('Emergency Department', 'Elizabeth Jackson', 'Elizabeth.Jackson@cshs.org', 'Assistant Nurse Manager', NULL, false),
('Emergency Department', 'Derrick McCarter', 'Derrick.McCarter@cshs.org', 'Assistant Nurse Manager', NULL, false),
('Emergency Department', 'Nili Steiner', 'Nili.Steiner@cshs.org', 'NPD Practitioner', NULL, false),
('Emergency Department', 'Mary Ann Rodgers', 'MaryAnn.Rodgers@cshs.org', 'NPD Practitioner', NULL, false),
('Emergency Department', 'Natalie Kustner', 'Natalie.Kustner@cshs.org', 'NPD Practitioner', NULL, false),

-- Float Pool
('Float Pool', 'Charina Emerson', 'Charina.Emerson@cshs.org', 'Executive Director', NULL, true),
('Float Pool', 'Jackie Marquez', 'Jackie.Marquez@cshs.org', 'Assistant Nurse Manager', NULL, false),
('Float Pool', 'Kaitlan McTiernan-Montes', 'Kaitlan.Mctiernan@cshs.org', 'Assistant Nurse Manager', NULL, false),
('Float Pool', 'Kristle Magtoto', 'KristleAnne.Magtoto@cshs.org', 'Assistant Nurse Manager', NULL, false),
('Float Pool', 'Bailee Hellwig', 'Bailee.Hellwig@cshs.org', 'NPD Practitioner', NULL, false),
('Float Pool', 'Abigail Leaders', 'Abigail.Leaders@cshs.org', 'NPD Practitioner', NULL, false),

-- Labor & Delivery
('Labor & Delivery', 'Nicole Schwartz', 'Nicole.Schwartz@cshs.org', 'Associate Director', NULL, true),
('Labor & Delivery', 'Jolene Kilcoyne', 'Jolene.Kilcoyne@cshs.org', 'Assistant Nurse Manager', 'Labor & Delivery', false),
('Labor & Delivery', 'Susan Kniseley', 'Susan.Kniseley@cshs.org', 'Assistant Nurse Manager', 'Labor & Delivery', false),
('Labor & Delivery', 'Carmen Chavez', 'Carmen.Chavez@cshs.org', 'Assistant Nurse Manager', 'Maternal Fetal Care Unit', false),

-- NICU
('NICU', 'Bevin Merideth', 'Bevin.Merideth@cshs.org', 'Associate Director', NULL, true),
('NICU', 'Geraldine Base', 'Geraldine.Base@cshs.org', 'Assistant Nurse Manager', NULL, false),
('NICU', 'Ashley Richardson', 'Ashley.Richardson@cshs.org', 'Assistant Nurse Manager', NULL, false),
('NICU', 'Amanda Williams', 'Amanda.Williams@cshs.org', 'Clinical Nurse Specialist', NULL, false),
('NICU', 'Melissa Arjon', 'melissa.arjon@cshs.org', 'NPD Practitioner', NULL, false),

-- Operating Room (not aspire_eligible by default)
('Operating Room', 'Elaine Suris', 'Elaine.Suris@cshs.org', 'Associate Director', NULL, true),
('Operating Room', 'Kirsten Aguilar', 'KirstenHazel.Aguilar@cshs.org', 'NPD Practitioner', NULL, false),
('Operating Room', 'Christine Chuey', 'Christine.Chuey@cshs.org', 'NPD Practitioner', NULL, false),

-- PACU
('PACU', 'Rusela DeSilva', 'rusela.desilva@cshs.org', 'Associate Director', 'Perioperative Services', true),
('PACU', 'Lillyann Rowe', 'lillyann.rowe@cshs.org', 'Assistant Nurse Manager', 'Preop-PACU', false),
('PACU', 'Anndre-Lee Deacon', 'anndre-lee.deacon@cshs.org', 'Assistant Nurse Manager', 'AHSP 4th floor PACU', false),
('PACU', 'Kescia Gray', 'kescia.gray2@cshs.org', 'NPD Practitioner', NULL, false),

-- Pediatrics
('Pediatrics', 'Maureen Chin', 'Maureen.Chin@cshs.org', 'Associate Director', NULL, true),
('Pediatrics', 'Alena Johantgen', 'Alena.Johantgen@cshs.org', 'Assistant Nurse Manager', NULL, false),
('Pediatrics', 'Tessie Guerrero', 'Tessie.Guerrero@cshs.org', 'Clinical Nurse Specialist', 'Pediatric Acute Care', false),

-- PICU
('PICU', 'Maureen Chin', 'Maureen.Chin@cshs.org', 'Associate Director', NULL, true),
('PICU', 'Marlena Tungate', 'Marlena.Tungate@cshs.org', 'Assistant Nurse Manager', NULL, false),
('PICU', 'Lauren Collins', 'Lauren.Collins@cshs.org', 'NPD Practitioner', 'Pediatric Intensive Care', false),

-- 3 North
('3 North', 'Rowena Pratap', 'Rowena.Pratap@cshs.org', 'Associate Director', NULL, true),
('3 North', 'Lauren Flowers', 'Lauren.Flowers@cshs.org', 'Assistant Nurse Manager', 'Obstetrics', false),
('3 North', 'Akal Khalsa', 'Akal.Khalsa@cshs.org', 'Assistant Nurse Manager', 'Obstetrics', false),
('3 North', 'Reanton Grana', 'Reanton.Grana@cshs.org', 'NPD Practitioner', 'Postpartum', false),

-- 3 SCCT
('3 SCCT', 'Heather Johnson', 'Heather.Johnson@cshs.org', 'Associate Director', NULL, true),
('3 SCCT', 'Dionne Reyes', 'Dionne.Reyes@cshs.org', 'Assistant Nurse Manager', NULL, false),
('3 SCCT', 'Stephanie Hagan', 'Stephanie.Hagan@cshs.org', 'NPD Practitioner', NULL, false),

-- 3 South Short Stay
('3 South Short Stay', 'Melanie Barone', 'Melanie.Barone@cshs.org', 'Associate Director', NULL, true),
('3 South Short Stay', 'Claudette Estrella', 'Claudette.Estrella@cshs.org', 'Assistant Nurse Manager', NULL, false),
('3 South Short Stay', 'Florida Pagador', 'Florida.Pagador@cshs.org', 'Assistant Nurse Manager', NULL, false),

-- 4 North (Acting AD)
('4 North', 'Iesha King', 'iesha.king@cshs.org', 'Acting Associate Director', NULL, true),
('4 North', 'Oscar Abarca', 'Oscar.Abarca@cshs.org', 'Assistant Nurse Manager', NULL, false),
('4 North', 'Preeyarat Laisuwan', 'Preeyarat.Laisuwan@cshs.org', 'NPD Practitioner', NULL, false),

-- 4 SCCT (CICU)
('4 SCCT', 'Alice Chan', 'Alice.Chan@cshs.org', 'Associate Director', NULL, true),
('4 SCCT', 'Anthony Andreas', 'Anthony.Andreas@cshs.org', 'Assistant Nurse Manager', NULL, false),
('4 SCCT', 'Jonathan Apolinario', 'Jonathan.Apolinario@cshs.org', 'Assistant Nurse Manager', NULL, false),
('4 SCCT', 'Weiting Chen', 'Weiting.Chen@cshs.org', 'NPD Practitioner', NULL, false),

-- 4 South
('4 South', 'Kimako Desvignes', 'kimako.desvignes@cshs.org', 'Associate Director', NULL, true),
('4 South', 'Herson Portillo', 'herson.portillo@cshs.org', 'Assistant Nurse Manager', NULL, false),
('4 South', 'Silva Amirkhanian', 'Silva.Amirkhanian@cshs.org', 'Assistant Nurse Manager', NULL, false),
('4 South', 'Sandra Rome', 'sandra.rome@cshs.org', 'Clinical Nurse Specialist', NULL, false),
('4 South', 'Vanessa Hernandez', 'vanessa.hernandez1@cshs.org', 'NPD Practitioner', NULL, false),

-- 5 North
('5 North', 'Kristoffer Alberto', 'kristoffer.alberto@cshs.org', 'Associate Director', NULL, true),
('5 North', 'Crystal Gonzalez', 'crystal.gonzalez@cshs.org', 'Assistant Nurse Manager', NULL, false),
('5 North', 'Miriam Rolon', 'Miriam.Rolon@cshs.org', 'Assistant Nurse Manager', NULL, false),
('5 North', 'Iris Hernandez', 'iris.hernandez@cshs.org', 'NPD Practitioner', NULL, false),

-- 5 SCCT (SICU)
('5 SCCT', 'Lyubov Tashlyk', 'Lyubov.Tashlyk@cshs.org', 'Associate Director', NULL, true),
('5 SCCT', 'Karina Finkelshteyn', 'Karina.Finkelshteyn@cshs.org', 'Assistant Nurse Manager', NULL, false),
('5 SCCT', 'Jose Chavez', 'Jose.Chavez3@cshs.org', 'Clinical Nurse Specialist', NULL, false),

-- 5 South
('5 South', 'Jeffrey Lopez', 'jeffrey.lopez@cshs.org', 'Associate Director', NULL, true),
('5 South', 'Janet Toledo', 'janet.toledo@cshs.org', 'Assistant Nurse Manager', NULL, false),
('5 South', 'Lloyd Dimayuga', 'lloydryan.dimayuga@cshs.org', 'Assistant Nurse Manager', NULL, false),
('5 South', 'Liz Hernandez', 'liz.hernandez@cshs.org', 'NPD Practitioner', NULL, false),

-- 6 North
('6 North', 'Priscilla Wilson', 'priscilla.wilson@cshs.org', 'Associate Director', NULL, true),
('6 North', 'Claire Dy', 'claire.dy@cshs.org', 'Assistant Nurse Manager', '6 NE', false),
('6 North', 'Joyce Serpas', 'joyce.serpas@cshs.org', 'Assistant Nurse Manager', '6 NW', false),
('6 North', 'Omar Tinio', 'Omar.Tinio@cshs.org', 'NPD Practitioner', NULL, false),

-- 6 SCCT (CSICU)
('6 SCCT', 'Alice Chan', 'Alice.Chan@cshs.org', 'Associate Director', NULL, true),
('6 SCCT', 'Jacob Cornett', 'Jacob.Cornett@cshs.org', 'Assistant Nurse Manager', NULL, false),
('6 SCCT', 'Jonathan Apolinario', 'Jonathan.Apolinario@cshs.org', 'Assistant Nurse Manager', NULL, false),

-- 6 South
('6 South', 'Jimmy Nguyen', 'jimmy.nguyen@cshs.org', 'Associate Director', NULL, true),
('6 South', 'Joicey Mathew', 'joicey.mathew@cshs.org', 'Assistant Nurse Manager', NULL, false),
('6 South', 'Kelly May', 'kelly.may@cshs.org', 'Assistant Nurse Manager', NULL, false),
('6 South', 'Eunice Santos', 'eunice.santos@cshs.org', 'NPD Practitioner', NULL, false),

-- 7 North
('7 North', 'Ann Gilligan', 'ann.gilligan@cshs.org', 'Associate Director', NULL, true),
('7 North', 'Rebeccah Le', 'rebeccah.le@cshs.org', 'Assistant Nurse Manager', NULL, false),
('7 North', 'Katherine Poulin', 'katherine.poulin@cshs.org', 'Assistant Nurse Manager', NULL, false),

-- 7 SCCT (MICU)
('7 SCCT', 'Lorraine Sheffield', 'lorraine.sheffield@cshs.org', 'Associate Director', NULL, true),
('7 SCCT', 'Charlotte Guevarra', 'Charlotte.Guevarra@cshs.org', 'Assistant Nurse Manager', NULL, false),
('7 SCCT', 'Jillian Felice', 'Jillian.Felice@cshs.org', 'NPD Practitioner', NULL, false),

-- 7 South
('7 South', 'Iesha King', 'iesha.king@cshs.org', 'Associate Director', NULL, true),
('7 South', 'Marian Josephin Sanchez', 'marianjosephin.sanchez@cshs.org', 'Assistant Nurse Manager', NULL, false),
('7 South', 'Edcynt Solita', 'edcynt.solita@cshs.org', 'Assistant Nurse Manager', NULL, false),
('7 South', 'Daniela Sassoon', 'daniela.sassoon@cshs.org', 'NPD Practitioner', NULL, false),

-- 8 North
('8 North', 'Aileen Espiritu-Tepper', 'aileen.espiritu@cshs.org', 'Associate Director', NULL, true),
('8 North', 'Ella Michaelian', 'ella.michaelian@cshs.org', 'Assistant Nurse Manager', NULL, false),
('8 North', 'Rinka Shiraishi', 'rinka.shiraishi@cshs.org', 'NPD Practitioner', NULL, false),

-- 8 SCCT (Neuro ICU)
('8 SCCT', 'Jenita Gutierrez', 'Jenita.Gutierrez@cshs.org', 'Associate Director', NULL, true),
('8 SCCT', 'Marianne Ferrer', 'Marianne.Ferrer@cshs.org', 'Assistant Nurse Manager', NULL, false),
('8 SCCT', 'Michael Erickson', 'Michael.Erickson@cshs.org', 'NPD Practitioner', NULL, false),

-- 8 South
('8 South', 'Golda Morales', 'golda.morales@cshs.org', 'Associate Director', NULL, true),
('8 South', 'Paul Cancio', 'paul.cancio@cshs.org', 'Assistant Nurse Manager', NULL, false),
('8 South', 'Scott Mondejar', 'scott.mondejar@cshs.org', 'Assistant Nurse Manager', NULL, false),
('8 South', 'Ryan Bailon', 'ryananthony.bailon@cshs.org', 'NPD Practitioner', NULL, false);
