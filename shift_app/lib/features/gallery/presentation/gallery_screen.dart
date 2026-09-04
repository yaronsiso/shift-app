import 'dart:io';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/marquee_bar.dart';
import '../../marquee/data/marquee_repository.dart';
import '../../render/data/render_providers.dart';
import '../../render/data/render_service.dart';

/// הגלריה האישית (סשן 9) — כל ההדמיות שהצליחו של המשתמש הנוכחי, החדשה
/// ביותר ראשונה. נגישה גם מאייקון בסרגל העליון של מסך הבית וגם מכפתור
/// במסך התוצאה (הוחלט מול ירון: שני מקומות כניסה). שומרת **רק** את
/// תמונת התוצאה (לא את תמונת ה"לפני") — גם זו החלטה מפורשת של ירון.
///
/// שום מיגרציה חדשה לא נדרשה בשביל המסך הזה: טבלת `renders` וה-Storage
/// כבר שומרים את כל מה שצריך מאז שלב 5, וה-RLS הקיים כבר מתיר SELECT
/// ו-DELETE למשתמש על השורות/הקבצים של עצמו בלבד (מיגרציה 0001).
class GalleryScreen extends ConsumerStatefulWidget {
  const GalleryScreen({super.key});

  @override
  ConsumerState<GalleryScreen> createState() => _GalleryScreenState();
}

class _GalleryScreenState extends ConsumerState<GalleryScreen> {
  late Future<List<RenderHistoryItem>> _future;

  @override
  void initState() {
    super.initState();
    _future = ref.read(renderServiceProvider).listMyRenders();
  }

  Future<void> _refresh() async {
    final next = ref.read(renderServiceProvider).listMyRenders();
    setState(() => _future = next);
    await next;
  }

  Future<void> _confirmDelete(RenderHistoryItem item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('gallery_screen.delete_confirm_title'.tr()),
        content: Text('gallery_screen.delete_confirm_body'.tr()),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text('gallery_screen.delete_confirm_cancel'.tr()),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(
              'gallery_screen.delete_confirm_yes'.tr(),
              style: const TextStyle(color: AppColors.danger),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await ref.read(renderServiceProvider).deleteRender(item);
      if (mounted) await _refresh();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('gallery_screen.delete_error'.tr())),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final marquee = ref.watch(marqueeMessagesProvider);

    return Scaffold(
      appBar: AppBar(title: Text('gallery_screen.app_title'.tr())),
      body: SafeArea(
        child: Column(
          children: [
            marquee.when(
              data: (messages) =>
                  MarqueeBar(messages: messages.map((m) => m.message).toList()),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),
            Expanded(
              child: FutureBuilder<List<RenderHistoryItem>>(
                future: _future,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snapshot.hasError) {
                    return _ErrorView(onRetry: _refresh);
                  }
                  final items = snapshot.data ?? const [];
                  if (items.isEmpty) {
                    return const _EmptyView();
                  }
                  return RefreshIndicator(
                    onRefresh: _refresh,
                    child: GridView.builder(
                      padding: const EdgeInsets.all(16),
                      gridDelegate:
                          const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        crossAxisSpacing: 12,
                        mainAxisSpacing: 12,
                        childAspectRatio: 1,
                      ),
                      itemCount: items.length,
                      itemBuilder: (context, i) => _GalleryTile(
                        item: items[i],
                        onDelete: () => _confirmDelete(items[i]),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GalleryTile extends ConsumerStatefulWidget {
  final RenderHistoryItem item;
  final VoidCallback onDelete;
  const _GalleryTile({required this.item, required this.onDelete});

  @override
  ConsumerState<_GalleryTile> createState() => _GalleryTileState();
}

class _GalleryTileState extends ConsumerState<_GalleryTile> {
  String? _url;
  bool _error = false;

  @override
  void initState() {
    super.initState();
    _resolve();
  }

  Future<void> _resolve() async {
    final path = widget.item.afterImagePath;
    if (path == null) {
      setState(() => _error = true);
      return;
    }
    try {
      final url = await ref.read(renderServiceProvider).signedUrlFor(path);
      if (mounted) setState(() => _url = url);
    } catch (_) {
      if (mounted) setState(() => _error = true);
    }
  }

  void _openDetail() {
    final url = _url;
    if (url == null) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _GalleryDetailScreen(
          imageUrl: url,
          renderId: widget.item.id,
          onDelete: widget.onDelete,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: Material(
        color: context.palette.accentSoft,
        child: InkWell(
          onTap: _url == null ? null : _openDetail,
          child: _url != null
              ? Image.network(_url!, fit: BoxFit.cover)
              : Center(
                  child: _error
                      ? Icon(Icons.broken_image_outlined,
                          color: context.palette.inkFaint)
                      : const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                ),
        ),
      ),
    );
  }
}

/// תצוגה מוגדלת של הדמיה בודדת מהגלריה — שיתוף/מחיקה. נפתחת כ-push רגיל
/// (לא דרך go_router — זו תצוגה זמנית שנפתחת רק מתוך הגלריה עצמה).
class _GalleryDetailScreen extends StatelessWidget {
  final String imageUrl;
  final String renderId;
  final VoidCallback onDelete;

  const _GalleryDetailScreen({
    required this.imageUrl,
    required this.renderId,
    required this.onDelete,
  });

  Future<void> _share(BuildContext context) async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse(imageUrl));
      final response = await request.close();
      final chunks = await response.toList();
      final bytes = chunks.expand((chunk) => chunk).toList();
      final file =
          await File('${Directory.systemTemp.path}/shift_$renderId.jpg')
              .writeAsBytes(bytes);
      client.close();
      await Share.shareXFiles([XFile(file.path)], text: 'SHIFT');
    } catch (_) {
      // לא קריטי — פשוט לא ישותף הפעם.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        actions: [
          IconButton(
            icon: const Icon(Icons.ios_share),
            tooltip: 'gallery_screen.share_button'.tr(),
            onPressed: () => _share(context),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'gallery_screen.delete_button'.tr(),
            onPressed: () {
              Navigator.of(context).pop();
              onDelete();
            },
          ),
        ],
      ),
      body: Center(
        child: InteractiveViewer(
          child: Image.network(imageUrl),
        ),
      ),
    );
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.photo_library_outlined,
                size: 48, color: context.palette.inkFaint),
            const SizedBox(height: 16),
            Text(
              'gallery_screen.empty_title'.tr(),
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 8),
            Text(
              'gallery_screen.empty_body'.tr(),
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: context.palette.inkSoft),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final Future<void> Function() onRetry;
  const _ErrorView({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: AppColors.danger),
            const SizedBox(height: 16),
            Text('gallery_screen.load_error'.tr()),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: onRetry,
              child: Text('gallery_screen.retry_button'.tr()),
            ),
          ],
        ),
      ),
    );
  }
}
