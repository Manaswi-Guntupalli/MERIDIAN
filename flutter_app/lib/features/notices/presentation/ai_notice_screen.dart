import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/ui/ui.dart';
import '../../notifications/data/notifications_repository.dart';
import '../data/notices_repository.dart';

/// AI Notice — AI-assisted professional school communication.
///
/// The staff member writes the facts, the assistant improves the wording, and
/// nothing is delivered until a human presses Review & Send. The audiences
/// offered come from the server, so a teacher is never shown a reach they do
/// not have.
class AiNoticeScreen extends ConsumerStatefulWidget {
  const AiNoticeScreen({super.key});

  @override
  ConsumerState<AiNoticeScreen> createState() => _AiNoticeScreenState();
}

const _contextPlaceholder =
    "Tomorrow's Chemistry practical has been moved from Period 2 to Period 5.\n\n"
    'Students should bring their lab coat and practical record book.';

class _AiNoticeScreenState extends ConsumerState<AiNoticeScreen> {
  final _subject = TextEditingController();
  final _context = TextEditingController();
  final _draft = TextEditingController();

  NoticeScope? _scope;
  String? _scopeId;
  NoticeRecipients? _recipients;
  String _tone = 'Professional';

  /// The model's wording, kept so the server can record whether the human
  /// changed it. Null means this notice was written without AI.
  String? _aiDraft;

  bool _drafting = false;
  bool _sending = false;

  @override
  void dispose() {
    _subject.dispose();
    _context.dispose();
    _draft.dispose();
    super.dispose();
  }

  AudienceOption? _selectedAudience(NoticePermissions perms) {
    if (_scope == null) return null;
    for (final a in perms.audiences) {
      if (a.scope == _scope) return a;
    }
    return null;
  }

  bool _canDraft(NoticePermissions perms) {
    final audience = _selectedAudience(perms);
    if (audience == null || _recipients == null) return false;
    if (audience.needsOption && (_scopeId == null || _scopeId!.isEmpty)) return false;
    return _subject.text.trim().isNotEmpty && _context.text.trim().isNotEmpty;
  }

  AudienceSelection _selection() => AudienceSelection(
        scope: _scope!,
        scopeId: _scopeId,
        recipients: _recipients!,
      );

  void _snack(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(message),
        backgroundColor: error ? AppColors.roseDeep : AppColors.slate900,
      ));
  }

  Future<void> _generate() async {
    setState(() => _drafting = true);
    try {
      final draft = await ref.read(noticesRepositoryProvider).draft(
            subject: _subject.text.trim(),
            context: _context.text.trim(),
            tone: _tone,
            audience: _selection(),
          );
      if (!mounted) return;
      setState(() {
        _draft.text = draft.text;
        _aiDraft = draft.text;
      });
    } catch (e) {
      // The typed context is the staff member's own work — never cleared.
      _snack('Unable to generate draft. Please try again.', error: true);
      debugPrint('AI Notice draft failed: ${friendlyError(e)}');
    } finally {
      if (mounted) setState(() => _drafting = false);
    }
  }

  Future<void> _send() async {
    setState(() => _sending = true);
    try {
      final result = await ref.read(noticesRepositoryProvider).send(
            subject: _subject.text.trim(),
            body: _draft.text.trim(),
            audience: _selection(),
            aiAssisted: _aiDraft != null,
            aiDraft: _aiDraft,
          );
      // The sender is a recipient of nothing here, but their own feed shows
      // school-wide activity — refresh it like any other delivered notification.
      ref.invalidate(notificationsProvider);
      if (!mounted) return;
      setState(() {
        _draft.clear();
        _subject.clear();
        _context.clear();
        _aiDraft = null;
      });
      _snack('Notice sent to ${result.delivered} recipient(s) — ${result.audience}.');
    } catch (e) {
      // The draft survives so the send can simply be retried.
      _snack(friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final perms = ref.watch(noticePermissionsProvider);

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
      children: [
        const MPageHeader(
          overline: 'Trust Core',
          title: 'AI Notice',
          subtitle:
              'Draft professional school notices using AI. You remain in full control before anything is sent.',
        ),
        MAsyncView<NoticePermissions>(
          value: perms,
          loadingLabel: 'Checking what you may send…',
          onRetry: () => ref.invalidate(noticePermissionsProvider),
          builder: (p) {
            if (p.isEmpty) {
              return const MEmptyState(
                icon: Icons.campaign_outlined,
                title: 'No audiences available to you',
                hint: 'Notices are sent to classes you teach. Ask the office if '
                    'you expect to see one here.',
              );
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _recipientsCard(p),
                const SizedBox(height: 14),
                _contextCard(p),
                const SizedBox(height: 14),
                _draftCard(p),
              ],
            );
          },
        ),
      ],
    );
  }

  // ── Recipients ─────────────────────────────────────────────────────────────
  Widget _recipientsCard(NoticePermissions p) {
    final audience = _selectedAudience(p);
    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const MSectionTitle(overline: 'Audience', title: 'Recipients'),
          DropdownButtonFormField<NoticeScope>(
            initialValue: _scope,
            decoration: const InputDecoration(labelText: 'Target'),
            items: [
              for (final a in p.audiences)
                DropdownMenuItem(value: a.scope, child: Text(a.label)),
            ],
            onChanged: (v) => setState(() {
              _scope = v;
              _scopeId = null;
              _recipients = null;
            }),
          ),
          if (audience != null && audience.needsOption) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _scopeId,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: audience.scope == NoticeScope.grade ? 'Grade' : 'Class',
              ),
              items: [
                for (final o in audience.options)
                  DropdownMenuItem(value: o.id, child: Text(o.label)),
              ],
              onChanged: (v) => setState(() => _scopeId = v),
            ),
          ],
          if (audience != null) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<NoticeRecipients>(
              initialValue: _recipients,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Send to'),
              items: [
                for (final r in audience.recipients)
                  DropdownMenuItem(value: r, child: Text(r.label)),
              ],
              onChanged: (v) => setState(() => _recipients = v),
            ),
          ],
        ],
      ),
    );
  }

  // ── Subject, context, tone ────────────────────────────────────────────────
  Widget _contextCard(NoticePermissions p) {
    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const MSectionTitle(overline: 'Your words', title: 'What has happened'),
          TextField(
            controller: _subject,
            maxLength: 160,
            decoration: const InputDecoration(
              labelText: 'Subject',
              hintText: 'Chemistry practical rescheduled',
              counterText: '',
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _context,
            maxLines: 6,
            maxLength: 4000,
            decoration: const InputDecoration(
              labelText: 'Context',
              hintText: _contextPlaceholder,
              alignLabelWithHint: true,
              counterText: '',
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _tone,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Tone'),
            items: [
              for (final t in p.tones) DropdownMenuItem(value: t, child: Text(t)),
            ],
            onChanged: (v) => setState(() => _tone = v ?? _tone),
          ),
          const SizedBox(height: 10),
          const Text(
            'Write the facts. The assistant improves the wording only — it never '
            'adds dates, times or details you did not write.',
            style: TextStyle(
                fontSize: 11.5, height: 1.45, color: AppColors.slate400),
          ),
          const SizedBox(height: 14),
          MButton(
            'Draft with AI',
            icon: Icons.auto_awesome,
            busy: _drafting,
            onPressed: _canDraft(p) && !_drafting ? _generate : null,
          ),
        ],
      ),
    );
  }

  // ── Review and send ───────────────────────────────────────────────────────
  Widget _draftCard(NoticePermissions p) {
    final hasDraft = _draft.text.trim().isNotEmpty;
    final edited = _aiDraft != null && _draft.text.trim() != _aiDraft!.trim();

    return MCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MSectionTitle(
            overline: 'Review',
            title: 'AI Draft',
            action: edited ? const MBadge('edited by you', severity: 'INFO') : null,
          ),
          if (!hasDraft)
            const MEmptyState(
              icon: Icons.auto_awesome_outlined,
              title: 'No draft yet',
              hint: 'Fill in the recipients and context, then use Draft with AI.',
            )
          else ...[
            TextField(
              controller: _draft,
              maxLines: 12,
              maxLength: 8000,
              decoration: const InputDecoration(
                alignLabelWithHint: true,
                counterText: '',
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            MButton(
              'Review & Send',
              icon: Icons.campaign_outlined,
              busy: _sending,
              onPressed: _sending ? null : _send,
            ),
            const SizedBox(height: 8),
            // Wrap, not two Expanded halves: at large text scales a half-width
            // slot clips the label, and these two should drop to their own
            // lines rather than truncate.
            Wrap(
              spacing: 10,
              runSpacing: 8,
              children: [
                MButton(
                  'Regenerate',
                  icon: Icons.refresh,
                  kind: MButtonKind.ghost,
                  dense: true,
                  busy: _drafting,
                  onPressed: _canDraft(p) && !_drafting && !_sending ? _generate : null,
                ),
                MButton(
                  'Discard',
                  icon: Icons.delete_outline,
                  kind: MButtonKind.ghost,
                  dense: true,
                  onPressed: _sending
                      ? null
                      : () => setState(() {
                            _draft.clear();
                            _aiDraft = null;
                          }),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.well,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.line),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.verified_user_outlined,
                      size: 15, color: AppColors.mint),
                  const SizedBox(width: 9),
                  const Expanded(
                    child: Text(
                      'Nothing is sent until you choose to send it. Recipients are '
                      'resolved on the server from your permissions, and the notice '
                      'you approve — not the AI draft — is what is delivered and '
                      'recorded in the Trust Ledger.',
                      style: TextStyle(
                          fontSize: 11.5,
                          height: 1.45,
                          color: AppColors.slate500),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
