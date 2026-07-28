import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../shared/navigation/nav_destination.dart';
import '../../../shared/ui/ui.dart';
import '../../../shared/widgets/app_background.dart';

/// The "More" grid — overflow destinations that don't fit the bottom bar.
/// Tapping one opens it as its own page (with a back button).
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key, required this.destinations});

  final List<MDestination> destinations;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      children: [
        const MPageHeader(title: 'More'),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: destinations.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            mainAxisExtent: 112, // fixed height, so tiles never overflow
          ),
          itemBuilder: (context, i) => _Tile(destination: destinations[i]),
        ),
      ],
    );
  }
}

class _Tile extends ConsumerWidget {
  const _Tile({required this.destination});
  final MDestination destination;

  /// Opening a destination from here tints the page to that module's colour
  /// and restores the grid's own tint on the way back — the same behaviour as
  /// navigating to its route on the web.
  Future<void> _open(BuildContext context, WidgetRef ref) async {
    final previous = ref.read(navGroupProvider);
    ref.read(navGroupProvider.notifier).set(destination.group);
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          appBar: AppBar(title: Text(destination.label)),
          body: destination.builder(context),
        ),
      ),
    );
    ref.read(navGroupProvider.notifier).set(previous);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MCard(
      padding: const EdgeInsets.all(16),
      onTap: () => _open(context, ref),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: AppColors.brand50,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(destination.icon, color: AppColors.brand, size: 20),
          ),
          const SizedBox(height: 10),
          Text(
            destination.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              color: AppColors.slate800,
            ),
          ),
        ],
      ),
    );
  }
}
