import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'model/graph_data.dart';
import 'widgets/workspace_graph_host.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final raw = await rootBundle.loadString('assets/graph-data.json');
  final data = GraphData.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  runApp(TotemWorkspaceApp(data: data));
}

class TotemWorkspaceApp extends StatelessWidget {
  const TotemWorkspaceApp({super.key, required this.data});

  final GraphData data;

  @override
  Widget build(BuildContext context) => MaterialApp(
        debugShowCheckedModeBanner: false,
        title: 'TOTEM Architecture Flutter',
        theme: ThemeData(
          brightness: Brightness.dark,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF22D3EE),
            brightness: Brightness.dark,
          ),
          scaffoldBackgroundColor: const Color(0xFF050B14),
          fontFamily: 'system-ui',
        ),
        home: WorkspaceGraphHost(initialData: data),
      );
}
