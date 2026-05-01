const WCU_NH_COORDS =
  'Therese Sandoval (ThSandoval@westcoastuniversity.edu); Laura Nunez (lNunez@westcoastuniversity.edu); Silvia St George (sStgeorge@westcoastuniversity.edu); Tony Kim (ToKim@westcoastuniversity.edu)'
const WCU_AN_COORDS =
  'Joelene Balatero (jBalatero@westcoastuniversity.edu); Rena Youssef (RYoussef@westcoastuniversity.edu)'
const APU_COORDS = 'Susan Hunter (shunter@apu.edu)'
const CSULB_COORDS = 'Lucy Van Otterloo (Lucy.VanOtterloo@csulb.edu)'
const CSULA_COORDS =
  'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)'

const base = {
  personal_email: '',
  phone: '',
  hours_completed: 0,
  unit: '',
  preceptor_name: '',
  ngrp_cohort_target: '',
  ngrp_outcome: 'Pending',
  gpa_verified: false,
  bls_current: false,
  health_cleared: false,
  background_check: false,
  notes: '',
}

export const SEED_STUDENTS = [
  // WCU North Hollywood
  { ...base, name: 'Kimberly Romero', school_email: 'kromero38@u.westcoastuniversity.edu', school: 'WCU North Hollywood', aspire_cohort: 'Summer 2026', term_dates: 'Jun 8 - Aug 18, 2026', hours_required: 90, coordinators: WCU_NH_COORDS, status: 'Form Sent' },
  { ...base, name: 'Marisol Peralta-Topete', school_email: 'mperalta-topete1@u.westcoastuniversity.edu', school: 'WCU North Hollywood', aspire_cohort: 'Summer 2026', term_dates: 'Jun 8 - Aug 18, 2026', hours_required: 90, coordinators: WCU_NH_COORDS, status: 'Form Sent' },
  { ...base, name: 'Melissa Rodriguez', school_email: 'mrodriguez101@u.westcoastuniversity.edu', school: 'WCU North Hollywood', aspire_cohort: 'Summer 2026', term_dates: 'Jun 8 - Aug 18, 2026', hours_required: 90, coordinators: WCU_NH_COORDS, status: 'Form Sent' },
  { ...base, name: 'Ofer DeLeon', school_email: 'odeleon1@u.westcoastuniversity.edu', school: 'WCU North Hollywood', aspire_cohort: 'Summer 2026', term_dates: 'Jun 8 - Aug 18, 2026', hours_required: 90, coordinators: WCU_NH_COORDS, status: 'Form Sent' },
  { ...base, name: 'Pedro Simon', school_email: 'psimon2@u.westcoastuniversity.edu', school: 'WCU North Hollywood', aspire_cohort: 'Summer 2026', term_dates: 'Jun 8 - Aug 18, 2026', hours_required: 90, coordinators: WCU_NH_COORDS, status: 'Form Sent' },
  // Azusa Pacific University
  { ...base, name: 'Wonsang Yun', school_email: 'wyun23@apu.edu', school: 'Azusa Pacific University', aspire_cohort: 'Summer 2026', term_dates: 'May 4 - Jul 30, 2026', hours_required: 180, coordinators: APU_COORDS, status: 'Form Sent' },
  { ...base, name: 'Dylan Cline', school_email: 'dcline24@apu.edu', school: 'Azusa Pacific University', aspire_cohort: 'Summer 2026', term_dates: 'May 4 - Jul 30, 2026', hours_required: 180, coordinators: APU_COORDS, status: 'Form Sent' },
  // Cal State Long Beach
  { ...base, name: 'Jayde De Leon', school_email: 'Jayde.Deleon01@student.csulb.edu', school: 'Cal State Long Beach', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 14, 2026', hours_required: 90, coordinators: CSULB_COORDS, status: 'Form Sent' },
  { ...base, name: 'Jorge Velasco', school_email: 'Jorge.Velasco01@student.csulb.edu', school: 'Cal State Long Beach', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 14, 2026', hours_required: 90, coordinators: CSULB_COORDS, status: 'Form Sent' },
  { ...base, name: 'Alison Curd', school_email: 'Alison.Curd01@student.csulb.edu', school: 'Cal State Long Beach', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 14, 2026', hours_required: 90, coordinators: CSULB_COORDS, status: 'Form Sent' },
  { ...base, name: 'Jonathan Tcheumani', school_email: 'Jonathan.Tcheumani01@student.csulb.edu', school: 'Cal State Long Beach', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 14, 2026', hours_required: 90, coordinators: CSULB_COORDS, status: 'Form Sent' },
  { ...base, name: 'James Mason', school_email: 'James.Mason01@student.csulb.edu', school: 'Cal State Long Beach', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 14, 2026', hours_required: 90, coordinators: CSULB_COORDS, status: 'Form Sent' },
  { ...base, name: 'Eileen Fuerte', school_email: 'Eileen.Fuerte01@student.csulb.edu', school: 'Cal State Long Beach', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 14, 2026', hours_required: 90, coordinators: CSULB_COORDS, status: 'Form Sent' },
  { ...base, name: 'Ivan Cruz', school_email: 'Ivan.Cruz01@student.csulb.edu', school: 'Cal State Long Beach', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 14, 2026', hours_required: 90, coordinators: CSULB_COORDS, status: 'Form Sent' },
  // Cal State LA
  { ...base, name: 'Saruulsanaa Bayaraa (Emi)', school_email: 'sbayara@calstatela.edu', school: 'Cal State LA', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 7, 2026', hours_required: 144, coordinators: CSULA_COORDS, status: 'Form Sent' },
  { ...base, name: 'Adam Friedenthal', school_email: 'afriede3@calstatela.edu', school: 'Cal State LA', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 7, 2026', hours_required: 144, coordinators: CSULA_COORDS, status: 'Form Sent' },
  { ...base, name: 'Michael Gonzales', school_email: 'mgonza515@calstatela.edu', school: 'Cal State LA', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 7, 2026', hours_required: 144, coordinators: CSULA_COORDS, status: 'Form Sent' },
  { ...base, name: 'Emma Haugstad', school_email: 'ehaugst@calstatela.edu', school: 'Cal State LA', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 7, 2026', hours_required: 144, coordinators: CSULA_COORDS, status: 'Form Sent' },
  { ...base, name: 'Vivian Huang', school_email: 'vhuang6@calstatela.edu', school: 'Cal State LA', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 7, 2026', hours_required: 144, coordinators: CSULA_COORDS, status: 'Form Sent' },
  { ...base, name: 'Daria Klenert', school_email: 'dklener@calstatela.edu', school: 'Cal State LA', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 7, 2026', hours_required: 144, coordinators: CSULA_COORDS, status: 'Form Sent' },
  { ...base, name: 'Megan Laird', school_email: 'mlaird@calstatela.edu', school: 'Cal State LA', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 7, 2026', hours_required: 144, coordinators: CSULA_COORDS, status: 'Form Sent' },
  { ...base, name: 'Juan Perez', school_email: 'jperez182@calstatela.edu', school: 'Cal State LA', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 7, 2026', hours_required: 144, coordinators: CSULA_COORDS, status: 'Form Sent' },
  { ...base, name: 'Justin Perr', school_email: 'jperr@calstatela.edu', school: 'Cal State LA', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 7, 2026', hours_required: 144, coordinators: CSULA_COORDS, status: 'Form Sent' },
  { ...base, name: 'Jungmin Shin (Brian)', school_email: 'jshin40@calstatela.edu', school: 'Cal State LA', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 7, 2026', hours_required: 144, coordinators: CSULA_COORDS, status: 'Form Sent' },
  { ...base, name: 'Carina Welch', school_email: 'cwelch2@calstatela.edu', school: 'Cal State LA', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 7, 2026', hours_required: 144, coordinators: CSULA_COORDS, status: 'Form Sent' },
  { ...base, name: 'Eliana York', school_email: 'eyork2@calstatela.edu', school: 'Cal State LA', aspire_cohort: 'Summer 2026', term_dates: 'Jun 1 - Aug 7, 2026', hours_required: 144, coordinators: CSULA_COORDS, status: 'Form Sent' },
  // WCU Anaheim
  { ...base, name: 'Lauren Chung', school_email: 'pending', school: 'WCU Anaheim', aspire_cohort: 'Summer 2026', term_dates: 'Jun 8 - Aug 16, 2026', hours_required: 90, coordinators: WCU_AN_COORDS, status: 'Form Sent' },
  { ...base, name: 'Vanessa Mored', school_email: 'pending', school: 'WCU Anaheim', aspire_cohort: 'Summer 2026', term_dates: 'Jun 8 - Aug 16, 2026', hours_required: 90, coordinators: WCU_AN_COORDS, status: 'Form Sent' },
  { ...base, name: 'Joshua Dela Cruz', school_email: 'pending', school: 'WCU Anaheim', aspire_cohort: 'Summer 2026', term_dates: 'Jun 8 - Aug 16, 2026', hours_required: 90, coordinators: WCU_AN_COORDS, status: 'Form Sent' },
]
