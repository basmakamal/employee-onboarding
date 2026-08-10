import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
// The SDK's zod helpers are typed against zod v4 — zod 3.25+ ships it here.
import { z } from 'zod/v4';
import type { PrismaClient } from '../generated/prisma/client.js';
import { GuardFailedError } from '../workflow/errors.js';

export type LetterLocale = 'ar' | 'en';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const PIPELINE = [
  'CREATED',
  'AWAITING_FORM',
  'FORM_RECEIVED',
  'CONTRACT_CREATION',
  'AWAITING_CONTRACT_APPROVAL',
  'EXPIRED',
];

/** Structured result of reading an identity/expiry document image. */
const ExtractedDocument = z.object({
  type: z
    .enum(['IQAMA', 'NATIONAL_ID', 'PASSPORT', 'CONTRACT', 'WORK_PERMIT', 'DRIVING_LICENSE', 'OTHER'])
    .describe('The kind of document shown'),
  number: z.string().nullable().describe('The document number exactly as printed, or null'),
  expiryDate: z
    .string()
    .nullable()
    .describe('Expiry date as YYYY-MM-DD (convert Hijri to Gregorian if only Hijri is shown), or null'),
  holderName: z.string().nullable().describe("The document holder's full name, or null"),
  notes: z
    .string()
    .nullable()
    .describe('Anything ambiguous or low-confidence the reviewer should double-check, or null'),
});

/**
 * All Claude-powered features live behind this one service: HR letter
 * drafting, the data-aware assistant, and document reading. Read-only
 * against the database; nothing here mutates records.
 */
export class AiService {
  private client: Anthropic | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly apiKey: string | undefined,
    private readonly model: string,
  ) {}

  /** AI endpoints stay mounted but fail with a clear message until configured. */
  private requireClient(): Anthropic {
    if (!this.apiKey) {
      throw new GuardFailedError(
        'AI_DISABLED',
        'AI features are not configured — set ANTHROPIC_API_KEY in backend/.env and restart',
      );
    }
    this.client ??= new Anthropic({ apiKey: this.apiKey });
    return this.client;
  }

  // ------------------------------------------------------------- HR letters

  /** Draft a formal HR letter (تعريف راتب، تعريف آيبان…) from real employee data. */
  async generateLetter(input: {
    employeeId: string;
    type: string;
    notes?: string;
    locale?: LetterLocale;
  }): Promise<{ letter: string }> {
    const client = this.requireClient();
    const employee = await this.prisma.employee.findUnique({
      where: { id: input.employeeId },
      include: { contract: true },
    });
    if (!employee) throw new GuardFailedError('NOT_FOUND', 'employee not found');

    const locale = input.locale ?? 'ar';
    const salaryTypes = ['SALARY_LETTER', 'BANK_LETTER'];
    const details = (employee.contract?.details ?? null) as Record<string, unknown> | null;
    const salary = salaryTypes.includes(input.type) ? (details?.['salary'] ?? null) : null;

    const facts = [
      `Full name: ${employee.firstName} ${employee.lastName}`,
      `Employee number: ${employee.employeeNo ?? '—'}`,
      `Job title: ${employee.jobTitle ?? '—'}`,
      `Department: ${employee.department ?? '—'}`,
      `National ID / Iqama: ${employee.nationalId ?? '—'}`,
      `Hire date: ${employee.hireDate ? employee.hireDate.toISOString().slice(0, 10) : '—'}`,
      `Employment type: ${employee.employmentType}`,
      ...(salary != null ? [`Monthly salary: ${salary} SAR`] : []),
      ...(input.notes ? [`Request notes from HR: ${input.notes}`] : []),
    ].join('\n');

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system:
        'You draft formal HR letters for Riyada (شركة ريادة), a Saudi company. ' +
        'Write complete, ready-to-print letters in the requested language: proper opening ' +
        '(e.g. السادة/ إلى من يهمه الأمر), body stating the facts, closing with a signature block for ' +
        '"إدارة الموارد البشرية / Human Resources Department". Use ONLY the facts provided — ' +
        'never invent numbers, dates, or amounts. If a needed fact is missing, put a clearly ' +
        'visible placeholder like [________]. Include today\'s date line as [التاريخ/Date]: ' +
        `${new Date().toISOString().slice(0, 10)}. Output the letter text only — no commentary, no markdown.`,
      messages: [
        {
          role: 'user',
          content:
            `Letter type: ${input.type}\nLanguage: ${locale === 'ar' ? 'Arabic' : 'English'}\n\n` +
            `Employee facts:\n${facts}`,
        },
      ],
    });

    const letter = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (!letter) throw new GuardFailedError('AI_EMPTY', 'the model returned no letter text');
    return { letter };
  }

  // --------------------------------------------------------- HR assistant

  /** Data-aware chat: Claude answers HR questions using read-only tools. */
  async chat(history: ChatTurn[]): Promise<{ reply: string }> {
    const client = this.requireClient();

    const countEmployees = betaZodTool({
      name: 'count_employees',
      description:
        'Count employees grouped by lifecycle status (onboarding pipeline, ACTIVE, INACTIVE), optionally filtered by department. Use for any headcount or "how many" question.',
      inputSchema: z.object({
        department: z.string().optional().describe('Filter to one department (exact name)'),
      }),
      run: async ({ department }) => {
        const rows = await this.prisma.employee.groupBy({
          by: ['status'],
          _count: { _all: true },
          ...(department ? { where: { department } } : {}),
        });
        return JSON.stringify(rows.map((r) => ({ status: r.status, count: r._count._all })));
      },
    });

    const searchEmployees = betaZodTool({
      name: 'search_employees',
      description:
        'Search employees by name, email, employee number, department, or status. Returns up to 20 compact rows.',
      inputSchema: z.object({
        query: z.string().optional().describe('Text matched against name, email and employee number'),
        status: z
          .string()
          .optional()
          .describe(`One of: ${[...PIPELINE, 'ACTIVE', 'INACTIVE'].join(', ')}`),
        department: z.string().optional(),
      }),
      run: async ({ query, status, department }) => {
        const rows = await this.prisma.employee.findMany({
          where: {
            ...(status ? { status: status as never } : {}),
            ...(department ? { department } : {}),
            ...(query
              ? {
                  OR: [
                    { firstName: { contains: query } },
                    { lastName: { contains: query } },
                    { email: { contains: query } },
                    { employeeNo: { contains: query } },
                  ],
                }
              : {}),
          },
          take: 20,
          orderBy: { createdAt: 'desc' },
        });
        return JSON.stringify(
          rows.map((e) => ({
            employeeNo: e.employeeNo,
            name: `${e.firstName} ${e.lastName}`,
            department: e.department,
            jobTitle: e.jobTitle,
            status: e.status,
            hireDate: e.hireDate?.toISOString().slice(0, 10) ?? null,
          })),
        );
      },
    });

    const expiringDocuments = betaZodTool({
      name: 'expiring_documents',
      description:
        'List tracked documents (Iqama, passport, contract end…) of ACTIVE employees expiring within N days, including already-expired ones. Use for renewal/expiry questions.',
      inputSchema: z.object({
        withinDays: z.number().int().min(1).max(365).describe('Look-ahead window in days'),
      }),
      run: async ({ withinDays }) => {
        const threshold = new Date(Date.now() + withinDays * 86_400_000);
        const rows = await this.prisma.employeeDocument.findMany({
          where: { expiryDate: { lte: threshold }, employee: { status: 'ACTIVE' } },
          include: { employee: { select: { employeeNo: true, firstName: true, lastName: true } } },
          orderBy: { expiryDate: 'asc' },
          take: 50,
        });
        return JSON.stringify(
          rows.map((d) => ({
            employee: `${d.employee.firstName} ${d.employee.lastName} (${d.employee.employeeNo ?? '—'})`,
            document: d.type,
            number: d.number,
            expiryDate: d.expiryDate.toISOString().slice(0, 10),
            daysLeft: Math.ceil((d.expiryDate.getTime() - Date.now()) / 86_400_000),
          })),
        );
      },
    });

    const employeeFile = betaZodTool({
      name: 'employee_file',
      description:
        'Full file snapshot of ONE employee by employee number or exact email: processes (GOSI/medical/criminal), custody forms, open offboarding. Use search_employees first if you only have a partial name.',
      inputSchema: z.object({
        employeeNo: z.string().optional().describe('e.g. EMP-0003'),
        email: z.string().optional(),
      }),
      run: async ({ employeeNo, email }) => {
        if (!employeeNo && !email) return 'Provide employeeNo or email.';
        const employee = await this.prisma.employee.findFirst({
          where: employeeNo ? { employeeNo } : { email: email as string },
          include: {
            gosi: true,
            medical: true,
            criminalRecord: true,
            assetForms: { include: { items: true } },
            offboardings: true,
            expiryDocuments: true,
          },
        });
        if (!employee) return 'No employee found.';
        return JSON.stringify({
          employeeNo: employee.employeeNo,
          name: `${employee.firstName} ${employee.lastName}`,
          status: employee.status,
          department: employee.department,
          jobTitle: employee.jobTitle,
          hireDate: employee.hireDate?.toISOString().slice(0, 10) ?? null,
          gosi: employee.gosi?.status ?? null,
          medical: employee.medical?.status ?? null,
          criminalRecord: employee.criminalRecord?.status ?? null,
          custodyForms: employee.assetForms.map((f) => ({ status: f.status, items: f.items.length })),
          openOffboarding:
            employee.offboardings.find((o) => !['CLOSED', 'CANCELLED'].includes(o.status))?.status ??
            null,
          trackedDocuments: employee.expiryDocuments.map((d) => ({
            type: d.type,
            expiryDate: d.expiryDate.toISOString().slice(0, 10),
          })),
        });
      },
    });

    const finalMessage = await client.beta.messages.toolRunner({
      model: this.model,
      max_tokens: 4096,
      system:
        'You are the built-in assistant of the Riyada HR system (نظام الموارد البشرية). ' +
        'Answer questions about employees, onboarding, documents, and offboarding using the tools — ' +
        'never guess data; if a tool returns nothing, say so. Reply in the language the user writes in ' +
        '(Arabic by default), concisely, in plain text without markdown headers. ' +
        `Today is ${new Date().toISOString().slice(0, 10)}. ` +
        'You are read-only: politely decline requests to change data and point to the relevant screen instead.',
      tools: [countEmployees, searchEmployees, expiringDocuments, employeeFile],
      messages: history.map((turn) => ({ role: turn.role, content: turn.content })),
    });

    const reply = finalMessage.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('\n')
      .trim();
    return { reply: reply || '…' };
  }

  // ---------------------------------------------------- document extraction

  /** Read an uploaded Iqama/passport/etc. and return fields for HR to confirm. */
  async extractDocument(
    file: { buffer: Buffer; mimeType: string },
  ): Promise<z.infer<typeof ExtractedDocument>> {
    const client = this.requireClient();
    const data = file.buffer.toString('base64');

    const source =
      file.mimeType === 'application/pdf'
        ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
        : ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: file.mimeType as 'image/jpeg' | 'image/png',
              data,
            },
          } as const);

    const response = await client.messages.parse({
      model: this.model,
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            source,
            {
              type: 'text',
              text:
                'Read this identity/official document and extract its fields. ' +
                'Transcribe the number exactly as printed. If the expiry date is Hijri only, ' +
                'convert it to Gregorian YYYY-MM-DD and mention the conversion in notes. ' +
                'Use null for anything you cannot read confidently.',
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(ExtractedDocument) },
    });

    const parsed = response.parsed_output;
    if (!parsed) throw new GuardFailedError('AI_EMPTY', 'the model could not read the document');
    return parsed;
  }
}
