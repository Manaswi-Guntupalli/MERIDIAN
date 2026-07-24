import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/widgets/brand_logo.dart';

/// Shown while the stored session is validated against `/auth/me` on launch.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const BrandLogo(size: 56),
            const SizedBox(height: 18),
            Text(
              'MERIDIAN',
              style: AppType.display(22, letterSpacing: 0.06)
                  .copyWith(color: AppColors.ink),
            ),
            const SizedBox(height: 6),
            Text(
              'School Operating System',
              style: TextStyle(
                fontSize: 12,
                color: AppColors.slate400,
                letterSpacing: 1,
              ),
            ),
            const SizedBox(height: 28),
            const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2.4),
            ),
          ],
        ),
      ),
    );
  }
}
