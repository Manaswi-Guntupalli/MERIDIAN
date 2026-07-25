import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Meridian mobile design system — a faithful port of the web `ui/index.tsx`.
// Same surfaces, severities, stat tiles, meters, empty/loading states, so the
// app reads as the same product. Import this one file.
// ─────────────────────────────────────────────────────────────────────────────

/// Accent used by StatTile / Meter, matching the web accents.
enum MAccent { brand, cyan, mint, amber, rose }

extension MAccentColor on MAccent {
  Color get color => switch (this) {
        MAccent.brand => AppColors.brand,
        MAccent.cyan => AppColors.cyan,
        MAccent.mint => AppColors.mint,
        MAccent.amber => AppColors.amber,
        MAccent.rose => AppColors.rose,
      };
}

/// Web `.card` — white paper surface, hairline border, 14px radius, soft shadow.
class MCard extends StatelessWidget {
  const MCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final content = Padding(padding: padding, child: child);
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadii.cardR,
        border: Border.all(color: AppColors.line),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A1C201F),
            blurRadius: 3,
            offset: Offset(0, 1),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: onTap == null
          ? content
          : Material(
              color: Colors.transparent,
              child: InkWell(onTap: onTap, child: content),
            ),
    );
  }
}

/// Web `Badge` — severity-tinted pill (text + 30% border + 10% fill), or a
/// neutral grey pill when no severity is given.
class MBadge extends StatelessWidget {
  const MBadge(this.label, {super.key, this.severity, this.icon});

  final String label;
  final String? severity; // SUCCESS | WARNING | CRITICAL | INFO
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final bool neutral = severity == null;
    final Color c = neutral ? AppColors.slate600 : AppColors.severity(severity);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: neutral ? AppColors.well : c.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: neutral ? AppColors.line : c.withValues(alpha: 0.30),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: c),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              color: c,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// Web `.chip` — rounded-full well with a hairline border and optional leading
/// live dot.
class MChip extends StatelessWidget {
  const MChip(this.label, {super.key, this.icon, this.dot = false});

  final String label;
  final IconData? icon;
  final bool dot;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.well,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot) ...[
            Container(
              width: 6,
              height: 6,
              decoration: const BoxDecoration(
                color: AppColors.mint,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 6),
          ] else if (icon != null) ...[
            Icon(icon, size: 13, color: AppColors.slate500),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: AppColors.slate600,
            ),
          ),
        ],
      ),
    );
  }
}

/// Web `.btn-primary` / `.btn-ghost` / danger — the three button weights the
/// web uses, with a built-in busy state so callers never hand-roll a spinner.
enum MButtonKind { primary, ghost, danger }

class MButton extends StatelessWidget {
  const MButton(
    this.label, {
    super.key,
    this.onPressed,
    this.icon,
    this.kind = MButtonKind.primary,
    this.busy = false,
    this.dense = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final MButtonKind kind;
  final bool busy;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final bool disabled = busy || onPressed == null;
    final (Color fg, Color bg, Color border) = switch (kind) {
      MButtonKind.primary => (Colors.white, AppColors.brand, AppColors.brand),
      MButtonKind.ghost => (AppColors.slate700, Colors.transparent, AppColors.line),
      MButtonKind.danger => (Colors.white, AppColors.rose, AppColors.rose),
    };
    final pad = dense
        ? const EdgeInsets.symmetric(horizontal: 12, vertical: 8)
        : const EdgeInsets.symmetric(horizontal: 16, vertical: 12);

    return Opacity(
      opacity: disabled ? 0.55 : 1,
      child: Material(
        color: bg,
        borderRadius: BorderRadius.circular(AppRadii.control),
        child: InkWell(
          onTap: disabled ? null : onPressed,
          borderRadius: BorderRadius.circular(AppRadii.control),
          child: Container(
            padding: pad,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadii.control),
              border: Border.all(color: border),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (busy) ...[
                  SizedBox(
                    width: 13,
                    height: 13,
                    child: CircularProgressIndicator(strokeWidth: 2, color: fg),
                  ),
                  const SizedBox(width: 8),
                ] else if (icon != null) ...[
                  Icon(icon, size: dense ? 14 : 16, color: fg),
                  const SizedBox(width: 7),
                ],
                Text(
                  label,
                  style: TextStyle(
                    color: fg,
                    fontSize: dense ? 12.5 : 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Web `StatTile` — a quiet accent rail, an uppercase label, a big serif value,
/// an optional sub-line, and an optional washed icon.
class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.label,
    required this.value,
    this.sub,
    this.icon,
    this.accent = MAccent.brand,
  });

  final String label;
  final String value;
  final String? sub;
  final IconData? icon;
  final MAccent accent;

  @override
  Widget build(BuildContext context) {
    final c = accent.color;
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadii.cardR,
        border: Border.all(color: AppColors.line),
        boxShadow: const [
          BoxShadow(color: Color(0x0A1C201F), blurRadius: 3, offset: Offset(0, 1)),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            left: 0,
            top: 12,
            bottom: 12,
            child: Container(
              width: 3,
              decoration: BoxDecoration(
                color: c,
                borderRadius: const BorderRadius.horizontal(right: Radius.circular(3)),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 14, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(label.toUpperCase(), style: AppType.label),
                    ),
                    if (icon != null)
                      Container(
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          color: c.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Icon(icon, size: 16, color: c),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                // Long values (₹17,83,275) must shrink rather than wrap — a
                // two-line figure breaks the tile's rhythm and, on narrow
                // phones, its height.
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    value,
                    maxLines: 1,
                    style: AppType.display(27,
                        weight: FontWeight.w600, letterSpacing: 0),
                  ),
                ),
                if (sub != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    sub!,
                    style: const TextStyle(fontSize: 12, color: AppColors.slate500),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Web `Meter` — a slim rounded track with a coloured fill.
class MMeter extends StatelessWidget {
  const MMeter({super.key, required this.value, this.accent = MAccent.brand});

  final double value; // 0..100
  final MAccent accent;

  @override
  Widget build(BuildContext context) {
    final v = value.clamp(0, 100) / 100;
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: LinearProgressIndicator(
        value: v.toDouble(),
        minHeight: 8,
        backgroundColor: AppColors.fill,
        valueColor: AlwaysStoppedAnimation(accent.color),
      ),
    );
  }
}

/// Web `PageHeader` — serif masthead with an eyebrow and optional actions.
class MPageHeader extends StatelessWidget {
  const MPageHeader({
    super.key,
    this.overline,
    required this.title,
    this.subtitle,
    this.actions,
  });

  final String? overline;
  final String title;
  final String? subtitle;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (overline != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                overline!.toUpperCase(),
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.4,
                  color: AppColors.brand,
                ),
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: Text(title, style: AppType.display(30, weight: FontWeight.w600))),
              if (actions != null) ...[
                const SizedBox(width: 12),
                ...actions!,
              ],
            ],
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 8),
            Text(
              subtitle!,
              style: const TextStyle(
                fontSize: 14,
                height: 1.5,
                color: AppColors.slate500,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Web `SectionTitle` — an overline + title row with an optional trailing action.
class MSectionTitle extends StatelessWidget {
  const MSectionTitle({super.key, this.overline, required this.title, this.action});

  final String? overline;
  final String title;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (overline != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Text(overline!.toUpperCase(), style: AppType.label),
                  ),
                Text(title, style: AppType.display(18, weight: FontWeight.w600)),
              ],
            ),
          ),
          ?action,
        ],
      ),
    );
  }
}

/// Web `LoadingScreen` — centred spinner with a label.
class MLoading extends StatelessWidget {
  const MLoading({super.key, this.label = 'Loading…'});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 26,
            height: 26,
            child: CircularProgressIndicator(strokeWidth: 2.6),
          ),
          const SizedBox(height: 12),
          Text(label, style: const TextStyle(fontSize: 14, color: AppColors.slate500)),
        ],
      ),
    );
  }
}

/// Web `EmptyState` — a dashed frame with an icon, title and hint.
class MEmptyState extends StatelessWidget {
  const MEmptyState({super.key, this.icon, required this.title, this.hint});

  final IconData? icon;
  final String title;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadii.lg),
        border: Border.all(color: AppColors.line, style: BorderStyle.solid),
      ),
      foregroundDecoration: _DashedBorder(color: AppColors.line, radius: AppRadii.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, color: AppColors.slate400, size: 28),
            const SizedBox(height: 8),
          ],
          Text(
            title,
            style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.slate600),
          ),
          if (hint != null) ...[
            const SizedBox(height: 4),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 280),
              child: Text(
                hint!,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13, color: AppColors.slate500),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Web `CellIdentity` — initials chip + title + sub-line, the roster row's
/// leading identity block. Used by Students and Staff so both read alike.
class MIdentity extends StatelessWidget {
  const MIdentity({
    super.key,
    required this.initials,
    required this.title,
    this.sub,
    this.accent = MAccent.brand,
  });

  final String initials;
  final String title;
  final String? sub;
  final MAccent accent;

  @override
  Widget build(BuildContext context) {
    final c = accent.color;
    return Row(
      children: [
        Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: c.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: c.withValues(alpha: 0.22)),
          ),
          child: Text(
            initials,
            style: TextStyle(
                fontSize: 12, fontWeight: FontWeight.w700, color: c),
          ),
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.slate900),
              ),
              if (sub != null && sub!.isNotEmpty)
                Text(
                  sub!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 12, color: AppColors.slate500),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The one place loading / failure / empty are decided, so every Phase 3
/// screen fails the same way: the backend's own message plus a retry, never a
/// blank screen and never a fabricated placeholder value.
class MAsyncView<T> extends StatelessWidget {
  const MAsyncView({
    super.key,
    required this.value,
    required this.builder,
    required this.onRetry,
    this.loadingLabel = 'Loading…',
    this.errorTitle = "Couldn't load this",
  });

  final AsyncValue<T> value;
  final Widget Function(T data) builder;
  final VoidCallback onRetry;
  final String loadingLabel;
  final String errorTitle;

  @override
  Widget build(BuildContext context) => value.when(
        loading: () => Padding(
          padding: const EdgeInsets.only(top: 70),
          child: MLoading(label: loadingLabel),
        ),
        error: (e, _) => Padding(
          padding: const EdgeInsets.only(top: 40),
          child: Column(
            children: [
              MEmptyState(
                icon: Icons.cloud_off_outlined,
                title: errorTitle,
                hint: friendlyError(e),
              ),
              const SizedBox(height: 12),
              MButton('Try again',
                  icon: Icons.refresh,
                  kind: MButtonKind.ghost,
                  onPressed: onRetry),
            ],
          ),
        ),
        data: builder,
      );
}

/// A subtle shimmer skeleton (web `.shimmer`).
class MSkeleton extends StatefulWidget {
  const MSkeleton({super.key, this.width, this.height = 14, this.radius = 10});
  final double? width;
  final double height;
  final double radius;

  @override
  State<MSkeleton> createState() => _MSkeletonState();
}

class _MSkeletonState extends State<MSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        final x = (_c.value * 2) - 1;
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.radius),
            gradient: LinearGradient(
              begin: Alignment(x - 1, 0),
              end: Alignment(x + 1, 0),
              colors: const [
                AppColors.well,
                Color(0xFFEDEBE4),
                AppColors.well,
              ],
              stops: const [0.3, 0.5, 0.7],
            ),
          ),
        );
      },
    );
  }
}

// A thin dashed border painted as a foreground decoration for the empty state.
class _DashedBorder extends Decoration {
  const _DashedBorder({required this.color, required this.radius});
  final Color color;
  final double radius;

  @override
  BoxPainter createBoxPainter([VoidCallback? onChanged]) =>
      _DashedPainter(color, radius);
}

class _DashedPainter extends BoxPainter {
  _DashedPainter(this.color, this.radius);
  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Offset offset, ImageConfiguration cfg) {
    final size = cfg.size!;
    final rect = offset & size;
    final rrect =
        RRect.fromRectAndRadius(rect.deflate(0.5), Radius.circular(radius));
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    final path = Path()..addRRect(rrect);
    const dash = 5.0, gap = 4.0;
    for (final metric in path.computeMetrics()) {
      double d = 0;
      while (d < metric.length) {
        canvas.drawPath(
          metric.extractPath(d, d + dash),
          paint,
        );
        d += dash + gap;
      }
    }
  }
}
