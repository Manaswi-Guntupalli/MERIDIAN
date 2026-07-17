// Lumen — the document type registry.
//
// This file is deliberately *data*, not logic. Adding a 17th document type is a
// matter of appending an entry here; no extractor, validator, or UI code has to
// change. That's the whole point of keeping layout knowledge declarative.
//
// Two rules we hold to:
//
// 1. **No fixed coordinates.** A field is found by its printed label, never by
//    "the box 40% down the page". Schools print the same form on a dozen
//    different letterheads, and coordinate templates shatter the first time a
//    logo changes size.
//
// 2. **Anchors are variants, not one canonical string.** Real forms say
//    "Student Name", "Name of Student", "Student's Full Name", and "Pupil
//    Name" for the same box. We list what we've actually seen.

import type { DocTemplate } from './types.js';

/** Anchors shared by most student-facing forms. */
const STUDENT_CORE: DocTemplate['fields'] = [
  { key: 'studentName', label: 'Student name', type: 'name', required: true, anchors: ["Student Name", "Name of Student", "Student's Name", "Full Name of Student", "Pupil Name", "Candidate Name"] },
  { key: 'fatherName', label: "Father's name", type: 'name', anchors: ["Father Name", "Father's Name", "Name of Father", "Father / Guardian Name"] },
  { key: 'motherName', label: "Mother's name", type: 'name', anchors: ["Mother Name", "Mother's Name", "Name of Mother"] },
  { key: 'dob', label: 'Date of birth', type: 'date', required: true, anchors: ['Date of Birth', 'DOB', 'Birth Date', 'D.O.B.'] },
  { key: 'gender', label: 'Gender', type: 'gender', options: ['Male', 'Female', 'Other'], anchors: ['Gender', 'Sex'] },
  { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Class Applied For', 'Standard', 'Grade', 'Class / Grade'] },
  { key: 'section', label: 'Section', type: 'text', anchors: ['Section', 'Div', 'Division'] },
  { key: 'bloodGroup', label: 'Blood group', type: 'bloodGroup', anchors: ['Blood Group', 'Blood Grp', 'Blood'] },
  { key: 'phone', label: 'Contact number', type: 'phone', required: true, anchors: ['Phone', 'Mobile', 'Contact Number', 'Mobile Number', 'Contact No', 'Phone Number'] },
  { key: 'email', label: 'Email', type: 'email', anchors: ['Email', 'E-mail', 'Email Address', 'E-mail ID'] },
  { key: 'address', label: 'Address', type: 'address', multiline: true, anchors: ['Address', 'Residential Address', 'Permanent Address', 'Home Address'] },
  { key: 'pincode', label: 'PIN code', type: 'pincode', anchors: ['PIN', 'PIN Code', 'Pincode', 'Postal Code', 'ZIP'] },
];

const GUARDIAN: DocTemplate['fields'] = [
  { key: 'guardianName', label: 'Guardian name', type: 'name', anchors: ['Guardian Name', "Guardian's Name", 'Local Guardian'] },
  { key: 'emergencyContact', label: 'Emergency contact', type: 'phone', anchors: ['Emergency Contact', 'Emergency Number', 'Emergency Phone', 'In Case of Emergency'] },
];

const STAFF_CORE: DocTemplate['fields'] = [
  { key: 'teacherName', label: 'Full name', type: 'name', required: true, anchors: ['Full Name', 'Name of Applicant', 'Applicant Name', 'Candidate Name', 'Employee Name', 'Teacher Name', 'Name'] },
  { key: 'dob', label: 'Date of birth', type: 'date', anchors: ['Date of Birth', 'DOB', 'D.O.B.'] },
  { key: 'gender', label: 'Gender', type: 'gender', options: ['Male', 'Female', 'Other'], anchors: ['Gender', 'Sex'] },
  { key: 'email', label: 'Email', type: 'email', required: true, anchors: ['Email', 'E-mail', 'Email Address', 'E-mail ID'] },
  { key: 'phone', label: 'Phone', type: 'phone', required: true, anchors: ['Phone', 'Mobile', 'Contact Number', 'Mobile Number', 'Contact No'] },
  { key: 'address', label: 'Address', type: 'address', multiline: true, anchors: ['Address', 'Residential Address', 'Permanent Address'] },
  { key: 'bloodGroup', label: 'Blood group', type: 'bloodGroup', anchors: ['Blood Group', 'Blood Grp'] },
];

export const TEMPLATES: DocTemplate[] = [
  {
    type: 'ADMISSION',
    label: 'Student Admission Form',
    commits: 'STUDENT',
    signals: [
      { phrase: 'admission form', weight: 10 },
      { phrase: 'application for admission', weight: 10 },
      { phrase: 'admission no', weight: 4 },
      { phrase: 'class applied for', weight: 5 },
      { phrase: 'previous school', weight: 3 },
      { phrase: 'date of admission', weight: 3 },
      { phrase: 'student name', weight: 2 },
    ],
    fields: [
      ...STUDENT_CORE,
      ...GUARDIAN,
      { key: 'admissionNo', label: 'Admission number', type: 'id', anchors: ['Admission No', 'Admission Number', 'Adm No', 'Admission ID'] },
      { key: 'admissionDate', label: 'Date of admission', type: 'date', anchors: ['Date of Admission', 'Admission Date', 'Joining Date'] },
      { key: 'previousSchool', label: 'Previous school', type: 'text', anchors: ['Previous School', 'Last School Attended', 'Name of Previous School'] },
      { key: 'category', label: 'Category', type: 'text', anchors: ['Category', 'Caste Category'] },
      { key: 'nationality', label: 'Nationality', type: 'text', anchors: ['Nationality'] },
      { key: 'signature', label: 'Signature', type: 'signature', anchors: ['Signature', "Parent's Signature", 'Signature of Parent', 'Applicant Signature'] },
    ],
  },
  {
    type: 'STUDENT_REGISTRATION',
    label: 'Student Registration Form',
    commits: 'STUDENT',
    signals: [
      { phrase: 'student registration', weight: 10 },
      { phrase: 'registration form', weight: 6 },
      { phrase: 'registration no', weight: 4 },
      { phrase: 'roll number', weight: 3 },
      { phrase: 'academic year', weight: 2 },
    ],
    fields: [
      ...STUDENT_CORE,
      ...GUARDIAN,
      { key: 'rollNo', label: 'Roll number', type: 'id', anchors: ['Roll No', 'Roll Number', 'Roll'] },
      { key: 'registrationNo', label: 'Registration number', type: 'id', anchors: ['Registration No', 'Registration Number', 'Reg No'] },
      { key: 'academicYear', label: 'Academic year', type: 'text', anchors: ['Academic Year', 'Session', 'Year'] },
    ],
  },
  {
    type: 'TEACHER_APPLICATION',
    label: 'Teacher Application / Registration Form',
    commits: 'TEACHER',
    signals: [
      { phrase: 'teacher application', weight: 10 },
      // Schools use "application" and "registration" interchangeably for the
      // same sheet of paper. Both land on this template; "employee
      // registration" stays distinct because it leads with a different word.
      { phrase: 'teacher registration', weight: 10 },
      { phrase: 'application for the post', weight: 8 },
      { phrase: 'teaching experience', weight: 6 },
      { phrase: 'subject specialisation', weight: 5 },
      { phrase: 'subject specialization', weight: 5 },
      { phrase: 'qualification', weight: 3 },
      { phrase: 'post applied for', weight: 6 },
    ],
    fields: [
      ...STAFF_CORE,
      { key: 'subject', label: 'Subject', type: 'text', anchors: ['Subject', 'Subject Specialisation', 'Subject Specialization', 'Subject Applied For', 'Teaching Subject'] },
      { key: 'qualification', label: 'Qualification', type: 'text', anchors: ['Qualification', 'Highest Qualification', 'Educational Qualification'] },
      { key: 'experienceYears', label: 'Experience (years)', type: 'decimal', min: 0, max: 55, anchors: ['Experience', 'Teaching Experience', 'Years of Experience', 'Total Experience'] },
      { key: 'postApplied', label: 'Post applied for', type: 'text', anchors: ['Post Applied For', 'Position Applied', 'Applied For', 'Designation Applied'] },
      { key: 'previousInstitution', label: 'Previous institution', type: 'text', anchors: ['Previous Institution', 'Previous School', 'Last Employer', 'Current Employer'] },
      { key: 'expectedSalary', label: 'Expected salary', type: 'money', anchors: ['Expected Salary', 'Salary Expected', 'Expected CTC'] },
      { key: 'signature', label: 'Signature', type: 'signature', anchors: ['Signature', 'Applicant Signature', 'Signature of Applicant'] },
    ],
  },
  {
    type: 'EMPLOYEE_REGISTRATION',
    label: 'Employee Registration Form',
    commits: 'TEACHER',
    signals: [
      { phrase: 'employee registration', weight: 10 },
      { phrase: 'employee id', weight: 6 },
      { phrase: 'employee code', weight: 5 },
      { phrase: 'date of joining', weight: 5 },
      { phrase: 'department', weight: 3 },
      { phrase: 'designation', weight: 3 },
      { phrase: 'staff record', weight: 5 },
    ],
    fields: [
      ...STAFF_CORE,
      { key: 'employeeId', label: 'Employee ID', type: 'id', required: true, anchors: ['Employee ID', 'Employee Code', 'Emp ID', 'Emp No', 'Staff ID'] },
      { key: 'designation', label: 'Designation', type: 'text', anchors: ['Designation', 'Role', 'Post'] },
      { key: 'department', label: 'Department', type: 'text', anchors: ['Department', 'Dept'] },
      { key: 'joiningDate', label: 'Date of joining', type: 'date', anchors: ['Date of Joining', 'Joining Date', 'DOJ'] },
      { key: 'salary', label: 'Salary', type: 'money', anchors: ['Salary', 'Monthly Salary', 'Gross Salary', 'Basic Pay'] },
      { key: 'panNumber', label: 'PAN', type: 'id', anchors: ['PAN', 'PAN Number', 'PAN No'] },
      { key: 'bankAccount', label: 'Bank account', type: 'id', anchors: ['Bank Account', 'Account Number', 'A/C No', 'Account No'] },
      { key: 'emergencyContact', label: 'Emergency contact', type: 'phone', anchors: ['Emergency Contact', 'Emergency Number'] },
    ],
  },
  {
    type: 'LEAVE',
    label: 'Leave Application',
    signals: [
      { phrase: 'leave application', weight: 10 },
      { phrase: 'application for leave', weight: 10 },
      { phrase: 'reason for leave', weight: 6 },
      { phrase: 'leave from', weight: 5 },
      { phrase: 'number of days', weight: 3 },
    ],
    fields: [
      { key: 'applicantName', label: 'Applicant name', type: 'name', required: true, anchors: ['Name', 'Student Name', 'Applicant Name', 'Employee Name'] },
      { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Standard', 'Grade'] },
      { key: 'section', label: 'Section', type: 'text', anchors: ['Section', 'Division'] },
      { key: 'fromDate', label: 'From date', type: 'date', required: true, anchors: ['From', 'From Date', 'Leave From', 'Start Date'] },
      { key: 'toDate', label: 'To date', type: 'date', required: true, anchors: ['To', 'To Date', 'Leave To', 'End Date'] },
      { key: 'days', label: 'Number of days', type: 'integer', min: 1, max: 365, anchors: ['Number of Days', 'No of Days', 'Total Days', 'Days'] },
      { key: 'reason', label: 'Reason', type: 'text', multiline: true, required: true, anchors: ['Reason', 'Reason for Leave', 'Purpose'] },
      { key: 'phone', label: 'Contact number', type: 'phone', anchors: ['Phone', 'Mobile', 'Contact Number'] },
      { key: 'signature', label: 'Signature', type: 'signature', anchors: ['Signature', "Parent's Signature", 'Applicant Signature'] },
    ],
  },
  {
    type: 'FEE_RECEIPT',
    label: 'Fee Receipt',
    signals: [
      { phrase: 'fee receipt', weight: 10 },
      { phrase: 'receipt no', weight: 6 },
      { phrase: 'amount paid', weight: 6 },
      { phrase: 'payment mode', weight: 5 },
      { phrase: 'tuition fee', weight: 4 },
      { phrase: 'received with thanks', weight: 6 },
    ],
    fields: [
      { key: 'studentName', label: 'Student name', type: 'name', required: true, anchors: ['Student Name', 'Name of Student', 'Received From'] },
      { key: 'admissionNo', label: 'Admission number', type: 'id', anchors: ['Admission No', 'Adm No', 'Student ID'] },
      { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Standard', 'Grade'] },
      { key: 'receiptNo', label: 'Receipt number', type: 'id', required: true, anchors: ['Receipt No', 'Receipt Number', 'Bill No'] },
      { key: 'amount', label: 'Amount', type: 'money', required: true, anchors: ['Amount', 'Amount Paid', 'Total Amount', 'Total', 'Grand Total'] },
      { key: 'paymentDate', label: 'Payment date', type: 'date', required: true, anchors: ['Date', 'Payment Date', 'Date of Payment'] },
      { key: 'paymentMode', label: 'Payment mode', type: 'text', options: ['Cash', 'Cheque', 'Online', 'UPI', 'Card'], anchors: ['Payment Mode', 'Mode of Payment', 'Paid By'] },
      { key: 'term', label: 'Term', type: 'text', anchors: ['Term', 'Quarter', 'Installment', 'Instalment'] },
      { key: 'balance', label: 'Balance due', type: 'money', anchors: ['Balance', 'Balance Due', 'Outstanding'] },
    ],
  },
  {
    type: 'REPORT_CARD',
    label: 'Report Card',
    signals: [
      { phrase: 'report card', weight: 10 },
      { phrase: 'progress report', weight: 9 },
      { phrase: 'grade obtained', weight: 5 },
      { phrase: 'class teacher remarks', weight: 6 },
      { phrase: 'attendance', weight: 3 },
      { phrase: 'term', weight: 2 },
    ],
    fields: [
      { key: 'studentName', label: 'Student name', type: 'name', required: true, anchors: ['Student Name', 'Name of Student', 'Name'] },
      { key: 'rollNo', label: 'Roll number', type: 'id', anchors: ['Roll No', 'Roll Number'] },
      { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Standard', 'Grade'] },
      { key: 'section', label: 'Section', type: 'text', anchors: ['Section', 'Division'] },
      { key: 'term', label: 'Term', type: 'text', anchors: ['Term', 'Examination', 'Exam'] },
      { key: 'totalMarks', label: 'Total marks', type: 'decimal', min: 0, max: 10000, anchors: ['Total Marks', 'Total', 'Grand Total'] },
      { key: 'percentage', label: 'Percentage', type: 'percentage', min: 0, max: 100, anchors: ['Percentage', 'Percent', '%'] },
      { key: 'grade', label: 'Grade', type: 'text', anchors: ['Grade', 'Overall Grade', 'Result'] },
      { key: 'attendance', label: 'Attendance', type: 'text', anchors: ['Attendance', 'Days Present', 'Attendance %'] },
      { key: 'remarks', label: 'Remarks', type: 'text', multiline: true, anchors: ['Remarks', 'Class Teacher Remarks', "Teacher's Remarks", 'Comments'] },
    ],
  },
  {
    type: 'MARK_SHEET',
    label: 'Mark Sheet',
    signals: [
      { phrase: 'mark sheet', weight: 10 },
      { phrase: 'marksheet', weight: 10 },
      { phrase: 'statement of marks', weight: 9 },
      { phrase: 'marks obtained', weight: 7 },
      { phrase: 'maximum marks', weight: 5 },
      { phrase: 'examination', weight: 2 },
    ],
    fields: [
      { key: 'studentName', label: 'Student name', type: 'name', required: true, anchors: ['Student Name', 'Name of Candidate', 'Candidate Name', 'Name'] },
      { key: 'rollNo', label: 'Roll number', type: 'id', required: true, anchors: ['Roll No', 'Roll Number', 'Seat No'] },
      { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Standard', 'Grade'] },
      { key: 'examName', label: 'Examination', type: 'text', anchors: ['Examination', 'Exam', 'Exam Name'] },
      { key: 'totalMarks', label: 'Marks obtained', type: 'decimal', min: 0, max: 10000, anchors: ['Total Marks Obtained', 'Marks Obtained', 'Total'] },
      { key: 'maxMarks', label: 'Maximum marks', type: 'decimal', min: 0, max: 10000, anchors: ['Maximum Marks', 'Max Marks', 'Out Of'] },
      { key: 'percentage', label: 'Percentage', type: 'percentage', min: 0, max: 100, anchors: ['Percentage', 'Percent'] },
      { key: 'result', label: 'Result', type: 'text', anchors: ['Result', 'Division', 'Status'] },
    ],
  },
  {
    type: 'BONAFIDE',
    label: 'Bonafide Certificate',
    signals: [
      { phrase: 'bonafide certificate', weight: 12 },
      { phrase: 'bona fide', weight: 10 },
      { phrase: 'is a bonafide student', weight: 10 },
      { phrase: 'this is to certify', weight: 5 },
    ],
    fields: [
      { key: 'studentName', label: 'Student name', type: 'name', required: true, anchors: ['Student Name', 'Name', 'Certify that'] },
      { key: 'fatherName', label: "Father's name", type: 'name', anchors: ["Father's Name", 'Son of', 'Daughter of', 'S/o', 'D/o'] },
      { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Standard', 'Studying in'] },
      { key: 'admissionNo', label: 'Admission number', type: 'id', anchors: ['Admission No', 'Adm No'] },
      { key: 'academicYear', label: 'Academic year', type: 'text', anchors: ['Academic Year', 'Session'] },
      { key: 'purpose', label: 'Purpose', type: 'text', anchors: ['Purpose', 'Issued For', 'Required For'] },
      { key: 'issueDate', label: 'Issue date', type: 'date', anchors: ['Date', 'Date of Issue', 'Issued On'] },
    ],
  },
  {
    type: 'TRANSFER_CERTIFICATE',
    label: 'Transfer Certificate',
    signals: [
      { phrase: 'transfer certificate', weight: 12 },
      { phrase: 'school leaving certificate', weight: 10 },
      { phrase: 'date of leaving', weight: 7 },
      { phrase: 'reason for leaving', weight: 7 },
      { phrase: 'conduct', weight: 3 },
    ],
    fields: [
      { key: 'studentName', label: 'Student name', type: 'name', required: true, anchors: ['Student Name', 'Name of Student', 'Name of Pupil', 'Name'] },
      { key: 'fatherName', label: "Father's name", type: 'name', anchors: ["Father's Name", 'Name of Father'] },
      { key: 'admissionNo', label: 'Admission number', type: 'id', anchors: ['Admission No', 'Adm No'] },
      { key: 'dob', label: 'Date of birth', type: 'date', anchors: ['Date of Birth', 'DOB'] },
      { key: 'admissionDate', label: 'Date of admission', type: 'date', anchors: ['Date of Admission', 'Admitted On'] },
      { key: 'leavingDate', label: 'Date of leaving', type: 'date', required: true, anchors: ['Date of Leaving', 'Leaving Date', 'Last Date of Attendance'] },
      { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Class in which Studying', 'Standard'] },
      { key: 'reason', label: 'Reason for leaving', type: 'text', multiline: true, anchors: ['Reason for Leaving', 'Reason'] },
      { key: 'conduct', label: 'Conduct', type: 'text', anchors: ['Conduct', 'Character', 'General Conduct'] },
    ],
  },
  {
    type: 'BUS_REGISTRATION',
    label: 'Bus Registration Form',
    signals: [
      { phrase: 'bus registration', weight: 10 },
      { phrase: 'transport form', weight: 9 },
      { phrase: 'transport registration', weight: 10 },
      { phrase: 'route no', weight: 7 },
      { phrase: 'pick up point', weight: 7 },
      { phrase: 'boarding point', weight: 7 },
    ],
    fields: [
      { key: 'studentName', label: 'Student name', type: 'name', required: true, anchors: ['Student Name', 'Name of Student', 'Name'] },
      { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Standard'] },
      { key: 'section', label: 'Section', type: 'text', anchors: ['Section', 'Division'] },
      { key: 'routeNo', label: 'Route number', type: 'id', required: true, anchors: ['Route No', 'Route Number', 'Bus Route', 'Route'] },
      { key: 'pickupPoint', label: 'Pick-up point', type: 'text', anchors: ['Pick Up Point', 'Pickup Point', 'Boarding Point', 'Stop'] },
      { key: 'dropPoint', label: 'Drop point', type: 'text', anchors: ['Drop Point', 'Drop Off Point', 'Alighting Point'] },
      { key: 'address', label: 'Address', type: 'address', multiline: true, anchors: ['Address', 'Residential Address'] },
      { key: 'phone', label: 'Contact number', type: 'phone', required: true, anchors: ['Phone', 'Mobile', 'Contact Number'] },
      { key: 'fee', label: 'Transport fee', type: 'money', anchors: ['Transport Fee', 'Bus Fee', 'Fee', 'Amount'] },
    ],
  },
  {
    type: 'LIBRARY',
    label: 'Library Form',
    signals: [
      { phrase: 'library form', weight: 10 },
      { phrase: 'library membership', weight: 10 },
      { phrase: 'library card', weight: 8 },
      { phrase: 'book issue', weight: 7 },
      { phrase: 'accession no', weight: 7 },
    ],
    fields: [
      { key: 'studentName', label: 'Student name', type: 'name', required: true, anchors: ['Student Name', 'Member Name', 'Name'] },
      { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Standard'] },
      { key: 'libraryCardNo', label: 'Library card number', type: 'id', anchors: ['Library Card No', 'Card No', 'Membership No'] },
      { key: 'bookTitle', label: 'Book title', type: 'text', anchors: ['Book Title', 'Title of Book', 'Book Name'] },
      { key: 'accessionNo', label: 'Accession number', type: 'id', anchors: ['Accession No', 'Accession Number'] },
      { key: 'issueDate', label: 'Issue date', type: 'date', anchors: ['Issue Date', 'Date of Issue', 'Issued On'] },
      { key: 'dueDate', label: 'Due date', type: 'date', anchors: ['Due Date', 'Return Date', 'Return By'] },
    ],
  },
  {
    type: 'MEDICAL',
    label: 'Medical Form',
    signals: [
      { phrase: 'medical form', weight: 10 },
      { phrase: 'medical record', weight: 9 },
      { phrase: 'health record', weight: 9 },
      { phrase: 'medical history', weight: 8 },
      { phrase: 'allergies', weight: 6 },
      { phrase: 'physician', weight: 5 },
    ],
    fields: [
      { key: 'studentName', label: 'Student name', type: 'name', required: true, anchors: ['Student Name', 'Patient Name', 'Name'] },
      { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Standard'] },
      { key: 'dob', label: 'Date of birth', type: 'date', anchors: ['Date of Birth', 'DOB'] },
      { key: 'bloodGroup', label: 'Blood group', type: 'bloodGroup', required: true, anchors: ['Blood Group', 'Blood Grp'] },
      { key: 'allergies', label: 'Allergies', type: 'text', multiline: true, anchors: ['Allergies', 'Known Allergies', 'Allergic To'] },
      { key: 'conditions', label: 'Medical conditions', type: 'text', multiline: true, anchors: ['Medical Conditions', 'Existing Conditions', 'Medical History', 'Chronic Illness'] },
      { key: 'medications', label: 'Medications', type: 'text', multiline: true, anchors: ['Medications', 'Current Medication', 'Regular Medicines'] },
      { key: 'physician', label: 'Physician', type: 'name', anchors: ['Physician', 'Doctor', 'Family Doctor', 'Consulting Physician'] },
      { key: 'physicianPhone', label: 'Physician phone', type: 'phone', anchors: ['Doctor Phone', 'Physician Contact', 'Clinic Number'] },
      { key: 'emergencyContact', label: 'Emergency contact', type: 'phone', required: true, anchors: ['Emergency Contact', 'Emergency Number'] },
    ],
  },
  {
    type: 'PARENT_CONSENT',
    label: 'Parent Consent Form',
    signals: [
      { phrase: 'consent form', weight: 10 },
      { phrase: 'parental consent', weight: 11 },
      { phrase: 'i hereby give my consent', weight: 11 },
      { phrase: 'i give permission', weight: 9 },
      { phrase: 'field trip', weight: 5 },
    ],
    fields: [
      { key: 'studentName', label: 'Student name', type: 'name', required: true, anchors: ['Student Name', 'Name of Child', 'Name of Student', 'Ward Name'] },
      { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Standard'] },
      { key: 'parentName', label: 'Parent name', type: 'name', required: true, anchors: ['Parent Name', 'Name of Parent', 'Guardian Name', "Parent's Name"] },
      { key: 'activity', label: 'Activity', type: 'text', multiline: true, anchors: ['Activity', 'Event', 'Trip', 'Purpose', 'Programme'] },
      { key: 'activityDate', label: 'Activity date', type: 'date', anchors: ['Date of Activity', 'Event Date', 'Trip Date', 'Date'] },
      { key: 'phone', label: 'Contact number', type: 'phone', required: true, anchors: ['Phone', 'Mobile', 'Contact Number'] },
      { key: 'consent', label: 'Consent given', type: 'checkbox', options: ['Yes', 'No'], anchors: ['Consent', 'I Agree', 'Permission Granted'] },
      { key: 'signature', label: 'Signature', type: 'signature', anchors: ['Signature', "Parent's Signature", 'Signature of Parent'] },
    ],
  },
  {
    type: 'ID_CARD',
    label: 'ID Card Application',
    signals: [
      { phrase: 'id card application', weight: 12 },
      { phrase: 'identity card', weight: 10 },
      { phrase: 'id card', weight: 7 },
      { phrase: 'duplicate card', weight: 6 },
      { phrase: 'photograph attached', weight: 5 },
    ],
    fields: [
      { key: 'holderName', label: 'Name', type: 'name', required: true, anchors: ['Name', 'Student Name', 'Applicant Name', 'Employee Name'] },
      { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Standard', 'Department'] },
      { key: 'idNumber', label: 'ID number', type: 'id', anchors: ['ID No', 'Admission No', 'Employee ID', 'Roll No'] },
      { key: 'dob', label: 'Date of birth', type: 'date', anchors: ['Date of Birth', 'DOB'] },
      { key: 'bloodGroup', label: 'Blood group', type: 'bloodGroup', anchors: ['Blood Group'] },
      { key: 'phone', label: 'Contact number', type: 'phone', anchors: ['Phone', 'Mobile', 'Contact Number'] },
      { key: 'address', label: 'Address', type: 'address', multiline: true, anchors: ['Address', 'Residential Address'] },
      { key: 'reason', label: 'Reason', type: 'text', anchors: ['Reason', 'Reason for Application', 'Lost / Damaged'] },
    ],
  },
  {
    type: 'SCHOLARSHIP',
    label: 'Scholarship Form',
    signals: [
      { phrase: 'scholarship', weight: 11 },
      { phrase: 'scholarship application', weight: 12 },
      { phrase: 'annual family income', weight: 8 },
      { phrase: 'merit', weight: 3 },
      { phrase: 'financial assistance', weight: 7 },
    ],
    fields: [
      { key: 'studentName', label: 'Student name', type: 'name', required: true, anchors: ['Student Name', 'Name of Applicant', 'Name'] },
      { key: 'fatherName', label: "Father's name", type: 'name', anchors: ["Father's Name", 'Name of Father'] },
      { key: 'className', label: 'Class', type: 'text', anchors: ['Class', 'Standard'] },
      { key: 'admissionNo', label: 'Admission number', type: 'id', anchors: ['Admission No', 'Adm No'] },
      { key: 'scholarshipType', label: 'Scholarship type', type: 'text', anchors: ['Scholarship Type', 'Type of Scholarship', 'Category', 'Scheme'] },
      { key: 'familyIncome', label: 'Annual family income', type: 'money', required: true, anchors: ['Annual Family Income', 'Family Income', 'Annual Income', 'Income'] },
      { key: 'percentage', label: 'Last exam percentage', type: 'percentage', min: 0, max: 100, anchors: ['Percentage', 'Last Exam Percentage', 'Marks Percentage', 'Aggregate'] },
      { key: 'bankAccount', label: 'Bank account', type: 'id', anchors: ['Bank Account', 'Account No', 'A/C No'] },
      { key: 'phone', label: 'Contact number', type: 'phone', anchors: ['Phone', 'Mobile', 'Contact Number'] },
    ],
  },
];

export const TEMPLATE_BY_TYPE = new Map(TEMPLATES.map((t) => [t.type, t]));

export function templateFor(type: string): DocTemplate {
  return TEMPLATE_BY_TYPE.get(type) ?? TEMPLATES[0];
}

/** Types the UI can offer as a manual override when the classifier is unsure. */
export const TEMPLATE_CHOICES = TEMPLATES.map((t) => ({ type: t.type, label: t.label }));
