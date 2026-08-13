import 'package:flutter/material.dart';

import '../../app/theme/tokens.dart';

/// Status pill. The colour always comes from `AppColors.forStatus`, so a
/// status can never mean two different things on two screens.
class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(T.rChip),
        border: Border.all(color: color),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}

/// Grey blocks in the shape of the content that is coming — never a bare
/// spinner in a list, which tells the user nothing about what to expect.
class ListSkeleton extends StatelessWidget {
  const ListSkeleton({super.key, this.itemHeight = 100, this.count = 5});

  final double itemHeight;
  final int count;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return ListView.separated(
      padding: const EdgeInsets.all(T.s16),
      itemCount: count,
      separatorBuilder: (_, _) => const SizedBox(height: T.s8),
      itemBuilder: (_, _) => Container(
        height: itemHeight,
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(T.rCard),
          border: Border.all(color: c.outline),
        ),
      ),
    );
  }
}

class EmptyStateView extends StatelessWidget {
  const EmptyStateView({
    super.key,
    required this.icon,
    required this.title,
    required this.hint,
    this.iconColor,
  });

  final IconData icon;
  final String title;
  final String hint;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(T.s32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: iconColor ?? c.muted),
            const SizedBox(height: T.s16),
            Text(
              title,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: T.s4),
            Text(
              hint,
              style: TextStyle(fontSize: 13, color: c.muted),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

/// Says what went wrong and offers the one thing worth doing about it.
class ErrorStateView extends StatelessWidget {
  const ErrorStateView({
    super.key,
    required this.message,
    required this.retryLabel,
    required this.onRetry,
  });

  final String message;
  final String retryLabel;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(T.s32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off_outlined, size: 40, color: c.muted),
            const SizedBox(height: T.s16),
            Text(
              message,
              style: const TextStyle(fontSize: 15),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: T.s16),
            OutlinedButton(onPressed: onRetry, child: Text(retryLabel)),
          ],
        ),
      ),
    );
  }
}

/// A titled block with a hairline border — the workhorse container.
class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    required this.title,
    required this.child,
    this.trailing,
  });

  final String title;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(T.s12),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(T.rCard),
        border: Border.all(color: c.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              ?trailing,
            ],
          ),
          const SizedBox(height: T.s12),
          child,
        ],
      ),
    );
  }
}
