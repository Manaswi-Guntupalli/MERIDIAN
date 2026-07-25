import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/ui/ui.dart';
import '../../dashboard/data/dashboard_repository.dart';
import '../../dashboard/data/intelligence_repository.dart';
import '../data/copilot_repository.dart';

/// Meridian Copilot on a phone. Answers come from the backend's event store —
/// the app displays them and never composes one itself. Action chips run the
/// real operation and the outcome comes back into the conversation.
class CopilotScreen extends ConsumerStatefulWidget {
  const CopilotScreen({super.key});

  @override
  ConsumerState<CopilotScreen> createState() => _CopilotScreenState();
}

class _Msg {
  _Msg.user(this.text)
      : isUser = true,
        meta = null;
  _Msg.assistant(this.text, {this.meta}) : isUser = false;

  final String text;
  final bool isUser;
  final CopilotAnswer? meta;
}

class _CopilotScreenState extends ConsumerState<CopilotScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<_Msg> _messages = [];
  bool _thinking = false;
  bool _executing = false;

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _send(String question) async {
    final q = question.trim();
    if (q.isEmpty || _thinking) return;
    _input.clear();
    setState(() {
      _messages.add(_Msg.user(q));
      _thinking = true;
    });
    _scrollToEnd();
    try {
      final answer = await ref.read(copilotRepositoryProvider).ask(q);
      if (!mounted) return;
      setState(() => _messages.add(_Msg.assistant(answer.answer, meta: answer)));
    } catch (e) {
      if (!mounted) return;
      setState(() => _messages
          .add(_Msg.assistant('Couldn’t answer that — ${friendlyError(e)}')));
    } finally {
      if (mounted) setState(() => _thinking = false);
      _scrollToEnd();
    }
  }

  Future<void> _execute(CopilotAction action) async {
    setState(() => _executing = true);
    try {
      final result = await ref
          .read(copilotRepositoryProvider)
          .execute(action.executeKind!, action.params);
      // The operation changed data the rest of the app shows.
      ref.invalidate(dashboardStatsProvider);
      ref.invalidate(intelligenceProvider);
      if (!mounted) return;
      final detail = result.detail.take(6).map((d) => '• $d').join('\n');
      setState(() => _messages.add(_Msg.assistant(
          '✓ ${result.summary}${detail.isEmpty ? '' : '\n$detail'}')));
    } catch (e) {
      if (!mounted) return;
      setState(() => _messages
          .add(_Msg.assistant('✗ Action failed — ${friendlyError(e)}')));
    } finally {
      if (mounted) setState(() => _executing = false);
      _scrollToEnd();
    }
  }

  @override
  Widget build(BuildContext context) {
    final suggestions = ref.watch(copilotSuggestionsProvider);

    return Column(
      children: [
        Expanded(
          child: _messages.isEmpty
              ? _Intro(
                  suggestions: suggestions.value ?? const [],
                  onPick: _send,
                )
              : ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                  itemCount: _messages.length + (_thinking ? 1 : 0),
                  itemBuilder: (context, i) {
                    if (i >= _messages.length) return const _Thinking();
                    return _Bubble(
                      msg: _messages[i],
                      executing: _executing,
                      onExecute: _execute,
                    );
                  },
                ),
        ),
        _Composer(
          controller: _input,
          enabled: !_thinking,
          onSend: () => _send(_input.text),
        ),
      ],
    );
  }
}

class _Intro extends StatelessWidget {
  const _Intro({required this.suggestions, required this.onPick});
  final List<String> suggestions;
  final void Function(String) onPick;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 40, 24, 20),
      children: [
        Center(
          child: Container(
            width: 58,
            height: 58,
            decoration: BoxDecoration(
              color: AppColors.brand,
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Icon(Icons.auto_awesome, color: Colors.white, size: 28),
          ),
        ),
        const SizedBox(height: 16),
        Center(
          child: Text('Your operational assistant',
              style: AppType.display(19, weight: FontWeight.w600)),
        ),
        const SizedBox(height: 6),
        const Center(
          child: Text(
            'Answers come from the event store — never invented.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: AppColors.slate500),
          ),
        ),
        const SizedBox(height: 22),
        if (suggestions.isEmpty)
          const Center(child: MSkeleton(width: 200, height: 12))
        else
          // A suggestion can be longer than the row it sits in, so each chip is
          // capped at the available width and its label wraps inside it —
          // otherwise a single long question overflows the Wrap.
          LayoutBuilder(
            builder: (context, constraints) => Wrap(
              spacing: 8,
              runSpacing: 8,
              alignment: WrapAlignment.center,
              children: [
                for (final s in suggestions)
                  GestureDetector(
                    onTap: () => onPick(s),
                    child: ConstrainedBox(
                      constraints:
                          BoxConstraints(maxWidth: constraints.maxWidth),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 9),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: AppColors.line),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.auto_awesome,
                                size: 12, color: AppColors.brand),
                            const SizedBox(width: 6),
                            Flexible(
                              child: Text(s,
                                  style: const TextStyle(
                                      fontSize: 12.5,
                                      color: AppColors.slate600)),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({
    required this.msg,
    required this.executing,
    required this.onExecute,
  });

  final _Msg msg;
  final bool executing;
  final void Function(CopilotAction) onExecute;

  @override
  Widget build(BuildContext context) {
    final m = msg;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment:
            m.isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          if (!m.isUser) ...[
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: AppColors.brand,
                borderRadius: BorderRadius.circular(9),
              ),
              child: const Icon(Icons.auto_awesome,
                  size: 15, color: Colors.white),
            ),
            const SizedBox(width: 9),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              decoration: BoxDecoration(
                color: m.isUser ? AppColors.brand50 : AppColors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                    color: m.isUser ? AppColors.brand100 : AppColors.line),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    m.text,
                    style: const TextStyle(
                        fontSize: 13.5, height: 1.5, color: AppColors.slate700),
                  ),
                  if (m.meta != null && m.meta!.actions.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 7,
                      runSpacing: 7,
                      children: [
                        for (final a in m.meta!.actions)
                          a.isExecutable
                              ? MButton(
                                  a.label,
                                  icon: Icons.bolt,
                                  dense: true,
                                  onPressed:
                                      executing ? null : () => onExecute(a),
                                )
                              : MChip(a.label, icon: Icons.north_east),
                      ],
                    ),
                  ],
                  if (m.meta != null) ...[
                    const SizedBox(height: 10),
                    const Divider(height: 1, color: AppColors.line),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(Icons.verified_user_outlined,
                            size: 13, color: AppColors.mint),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            'Grounded · ${m.meta!.provenance}',
                            style: const TextStyle(
                                fontSize: 11, color: AppColors.slate500),
                          ),
                        ),
                        Text(
                          '${(m.meta!.confidence * 100).round()}% conf.',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: m.meta!.confidence >= 0.75
                                ? AppColors.mint
                                : m.meta!.confidence >= 0.5
                                    ? AppColors.amber
                                    : AppColors.rose,
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Thinking extends StatelessWidget {
  const _Thinking();

  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.only(bottom: 14),
        child: Row(
          children: [
            SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2.2),
            ),
            SizedBox(width: 10),
            Text('Thinking…',
                style: TextStyle(fontSize: 13, color: AppColors.slate500)),
          ],
        ),
      );
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.enabled,
    required this.onSend,
  });

  final TextEditingController controller;
  final bool enabled;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.line)),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                enabled: enabled,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => onSend(),
                decoration: const InputDecoration(
                  hintText: 'Ask about attendance, fees, staff…',
                ),
              ),
            ),
            const SizedBox(width: 9),
            MButton('Ask', icon: Icons.send, onPressed: enabled ? onSend : null),
          ],
        ),
      ),
    );
  }
}
