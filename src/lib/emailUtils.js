export function buildUnitLeaderEmail({
  contactPersons,
  contactEmails,
  unitName,
  students,
  isMultiStudent = false
}) {
  const emailList = contactEmails
    .split(/[;,]/)
    .map(e => e.trim())
    .filter(Boolean)
    .join(',')

  const subject = isMultiStudent
    ? `ASPIRE Program Student Placements – ${unitName}`
    : `ASPIRE Program Student Placement – ${students[0].lastName}, ${students[0].firstName} | ${unitName}`

  const studentBlock = students.map(s => `
Student: ${s.lastName}, ${s.firstName}
School: ${s.school}
Program: ${s.programType || 'N/A'}
Term Dates: ${s.termDates || 'TBD'}
Hours Required: ${s.hoursRequired ? s.hoursRequired + ' hours' : 'TBD'}
Shift Preference: ${s.shiftPreference || 'TBD'}
${s.preceptorAssigned ? `Assigned Preceptor: ${s.preceptorAssigned}` : 'Preceptor: To be confirmed'}
`).join('\n---\n')

  const greeting = contactPersons.includes(',')
    ? `Dear ${contactPersons.split(',')[0].trim().split(' ')[0]} and team,`
    : `Dear ${contactPersons.split(' ')[0]},`

  const body = `${greeting}

Thank you for your continued support of the ASPIRE Program (Affiliate Students' Pathway from Internship to Residency Experience) at Cedars-Sinai. We are grateful for your unit's commitment to hosting senior nursing students this cycle.

We are pleased to share the following placement${students.length > 1 ? 's' : ''} for your unit:

${studentBlock}

To complete this placement, please confirm with your team which preceptor will be working with this student and reply to this email so we can coordinate next steps. Once confirmed, we will send the preceptor a separate onboarding email with full details and guidelines.

If you have any questions or concerns about this placement, please do not hesitate to reach out.

Thank you again for your support of clinical nursing education at Cedars-Sinai.

Warm regards,
Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
Nursing Professional Development Practitioner
Geri and Richard Brawerman Nursing Institute
JesterLloyd.Bautista@cshs.org | 310-248-8964`

  return `https://outlook.office.com/mail/deeplink/compose?bcc=${encodeURIComponent(emailList)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
