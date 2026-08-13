import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/i18n/strings.dart';
import '../../app/theme/tokens.dart';
import '../../core/network/api_client.dart';
import '../../core/widgets/states.dart';
import 'employee_models.dart';
import 'employee_providers.dart';

/// Plate 07 — the employee file, overview. A triage screen: what is wrong
/// with this person's file, and what can I do about it right now.
///
/// Every button on this screen comes from the server's `availableActions`.
/// There is no role check anywhere in this file, by design.
class EmployeeScreen extends ConsumerWidget {
  const EmployeeScreen({super.key, required this.employeeId});

  final String employeeId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final detail = ref.watch(employeeDetailProvider(employeeId));

    return Scaffold(
      appBar: AppBar(title: Text(s.employeeFile)),
      body: detail.when(
        loading: () => const ListSkeleton(itemHeight: 120, count: 3),
        error: (e, _) => ErrorStateView(
          message: e is ApiException && e.code == 'OFFLINE'
              ? s.offline
              : s.somethingWrong,
          retryLabel: s.retry,
          onRetry: () => ref.invalidate(employeeDetailProvider(employeeId)),
        ),
        data: (emp) => RefreshIndicator(
          onRefresh: () async =>
              ref.refresh(employeeDetailProvider(employeeId).future),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(T.s16, T.s12, T.s16, T.s24),
            children: [
              _Header(emp: emp),
              const SizedBox(height: T.s12),
              if (emp.processes.isNotEmpty) ...[
                _Processes(emp: emp),
                const SizedBox(height: T.s12),
              ],
              _Employment(emp: emp),
            ],
          ),
        ),
      ),
      bottomNavigationBar: detail.maybeWhen(
        data: (emp) => _ActionBar(emp: emp),
        orElse: () => null,
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.emp});

  final EmployeeDetail emp;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final c = context.c;
    return Container(
      padding: const EdgeInsets.all(T.s12),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(T.rCard),
        border: Border.all(color: c.outline),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: c.tint,
              borderRadius: BorderRadius.circular(T.rCard),
              border: Border.all(color: c.outline),
            ),
            alignment: Alignment.center,
            child: Icon(Icons.person_outline, color: c.primary),
          ),
          const SizedBox(width: T.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  emp.fullName,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(height: T.s8),
                Wrap(
                  spacing: T.s8,
                  runSpacing: T.s4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    StatusChip(
                      label: s.status(emp.status),
                      color: c.forStatus(emp.status),
                    ),
                    if (emp.employeeNo != null)
                      Text(
                        emp.employeeNo!,
                        style: TextStyle(fontSize: 11.5, color: c.muted),
                        textDirection: TextDirection.ltr,
                      ),
                    if (emp.department != null && emp.department!.isNotEmpty)
                      Text(
                        emp.department!,
                        style: TextStyle(fontSize: 11.5, color: c.muted),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Processes extends ConsumerWidget {
  const _Processes({required this.emp});

  final EmployeeDetail emp;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final c = context.c;
    final done = emp.processes.where((p) => p.status == 'DONE').length;

    return SectionCard(
      title: s.stageTwoProcesses,
      trailing: Text(
        s.doneOf(done, emp.processes.length),
        style: TextStyle(fontSize: 11.5, color: c.muted),
      ),
      child: Column(
        children: [
          for (var i = 0; i < emp.processes.length; i++) ...[
            if (i > 0) Divider(color: c.outline, height: T.s24),
            _ProcessRow(emp: emp, track: emp.processes[i]),
          ],
        ],
      ),
    );
  }
}

class _ProcessRow extends ConsumerWidget {
  const _ProcessRow({required this.emp, required this.track});

  final EmployeeDetail emp;
  final ProcessTrack track;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final c = context.c;

    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                s.processName(track.key),
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (track.holdReason != null) ...[
                const SizedBox(height: 2),
                Text(
                  s.holdReason(track.holdReason!),
                  style: TextStyle(fontSize: 11.5, color: c.muted),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(width: T.s8),
        StatusChip(
          label: s.status(track.status),
          color: c.forStatus(track.status),
        ),
        if (track.actions.isNotEmpty)
          IconButton(
            icon: const Icon(Icons.more_horiz, size: 20),
            tooltip: s.actions,
            onPressed: () => _openProcessActions(context, ref, emp, track),
          ),
      ],
    );
  }
}

class _Employment extends StatelessWidget {
  const _Employment({required this.emp});

  final EmployeeDetail emp;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final rows = <(String, String)>[
      if (emp.jobTitle != null && emp.jobTitle!.isNotEmpty)
        (s.jobTitle, emp.jobTitle!),
      if (emp.employmentType != null)
        (s.employmentType, s.employmentTypeLabel(emp.employmentType!)),
      if (emp.hireDate != null)
        (s.hireDate, emp.hireDate!.toIso8601String().substring(0, 10)),
      if (emp.project != null && emp.project!.isNotEmpty)
        (s.project, emp.project!),
      if (emp.email != null && emp.email!.isNotEmpty) (s.email, emp.email!),
      if (emp.phone != null && emp.phone!.isNotEmpty) (s.phone, emp.phone!),
    ];

    if (rows.isEmpty) return const SizedBox.shrink();
    final c = context.c;

    return SectionCard(
      title: s.employment,
      child: Column(
        children: [
          for (final (label, value) in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: T.s8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: TextStyle(fontSize: 12, color: c.muted)),
                  const SizedBox(width: T.s16),
                  Expanded(
                    child: Text(
                      value,
                      textAlign: TextAlign.end,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// The pipeline actions the server offers, primary verb last (trailing edge).
class _ActionBar extends ConsumerWidget {
  const _ActionBar({required this.emp});

  final EmployeeDetail emp;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (emp.availableActions.isEmpty) return const SizedBox.shrink();
    final s = S.of(context);
    final c = context.c;
    final actions = emp.availableActions;
    final primary = actions.last;
    final rest = actions.sublist(0, actions.length - 1);

    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(T.s16, T.s12, T.s16, T.s12),
        decoration: BoxDecoration(
          color: c.surface,
          border: Border(top: BorderSide(color: c.outline)),
        ),
        child: Row(
          children: [
            if (rest.isNotEmpty)
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _openPipelineActions(context, ref, emp, rest),
                  child: Text(s.moreActions),
                ),
              ),
            if (rest.isNotEmpty) const SizedBox(width: T.s8),
            Expanded(
              flex: 2,
              child: FilledButton(
                onPressed: () => _runPipeline(context, ref, emp, primary),
                child: Text(s.action(primary)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── action plumbing ─────────────────────────────────────────────────────────

Future<void> _openPipelineActions(
  BuildContext context,
  WidgetRef ref,
  EmployeeDetail emp,
  List<String> actions,
) async {
  final s = S.of(context);
  final chosen = await showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final a in actions)
            ListTile(
              title: Text(s.action(a)),
              onTap: () => Navigator.of(ctx).pop(a),
            ),
        ],
      ),
    ),
  );
  if (chosen != null && context.mounted) {
    await _runPipeline(context, ref, emp, chosen);
  }
}

Future<void> _runPipeline(
  BuildContext context,
  WidgetRef ref,
  EmployeeDetail emp,
  String action,
) async {
  final s = S.of(context);
  final messenger = ScaffoldMessenger.of(context);
  try {
    await ref.read(employeeActionsProvider).pipeline(emp.id, action);
    messenger.showSnackBar(SnackBar(content: Text(s.actionDone)));
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  }
}

/// HOLD needs a reason before it can be recorded, so it opens a form rather
/// than firing straight away — the audit trail must never say "held: blank".
Future<void> _openProcessActions(
  BuildContext context,
  WidgetRef ref,
  EmployeeDetail emp,
  ProcessTrack track,
) async {
  final s = S.of(context);
  final chosen = await showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(T.s16, 0, T.s16, T.s8),
            child: Text(
              s.processName(track.key),
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
          ),
          for (final a in track.actions)
            ListTile(
              title: Text(s.action(a)),
              onTap: () => Navigator.of(ctx).pop(a),
            ),
        ],
      ),
    ),
  );
  if (chosen == null || !context.mounted) return;

  String? reason;
  String? note;
  if (chosen == 'HOLD') {
    final result = await _askHoldReason(context);
    if (result == null || !context.mounted) return;
    reason = result.$1;
    note = result.$2;
  }

  final messenger = ScaffoldMessenger.of(context);
  try {
    await ref.read(employeeActionsProvider).process(
          emp.id,
          track.key,
          chosen,
          holdReason: reason,
          holdNote: note,
        );
    messenger.showSnackBar(SnackBar(content: Text(s.actionDone)));
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  }
}

const _holdReasons = [
  'ID_MISMATCH',
  'DOB_MISMATCH',
  'GOVERNMENT_EMPLOYEE',
  'OPTIONAL_SUBSCRIPTION',
  'INCOMPLETE_DATA',
  'OTHER',
];

Future<(String, String)?> _askHoldReason(BuildContext context) {
  final s = S.of(context);
  final noteCtrl = TextEditingController();
  String selected = _holdReasons.first;

  return showModalBottomSheet<(String, String)>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => Padding(
      padding: EdgeInsets.only(
        left: T.s16,
        right: T.s16,
        bottom: MediaQuery.of(ctx).viewInsets.bottom + T.s16,
      ),
      child: StatefulBuilder(
        builder: (ctx, setState) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              s.holdTitle,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: T.s16),
            DropdownButtonFormField<String>(
              initialValue: selected,
              decoration: InputDecoration(labelText: s.reason),
              items: [
                for (final r in _holdReasons)
                  DropdownMenuItem(value: r, child: Text(s.holdReason(r))),
              ],
              onChanged: (v) => setState(() => selected = v ?? selected),
            ),
            const SizedBox(height: T.s12),
            TextField(
              controller: noteCtrl,
              maxLines: 2,
              decoration: InputDecoration(labelText: s.noteOptional),
            ),
            const SizedBox(height: T.s16),
            FilledButton(
              onPressed: () =>
                  Navigator.of(ctx).pop((selected, noteCtrl.text.trim())),
              child: Text(s.confirmHold),
            ),
            const SizedBox(height: T.s8),
          ],
        ),
      ),
    ),
  );
}
