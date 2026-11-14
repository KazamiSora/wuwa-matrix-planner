"""Package current source and a GitHub upload folder without requiring Git staging."""
import argparse
import hashlib
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = (
    '.gitignore', '启动Demo.cmd', 'app.js', 'CHANGELOG.md', 'index.html',
    'package.json', 'plan-library.js', 'README.md', 'score_core.py',
    'score-axis.js', 'season-config.js', 'server.mjs', 'styles.css',
    'THIRD_PARTY_NOTICES.md',
)
DESKTOP_FILES = ('Launcher.cs', '使用说明.txt', 'LICENSE.node.txt')
TREE_TYPES = {
    'config': {'.json'}, 'docs': {'.md'}, 'tests': {'.mjs', '.py'},
    'tools': {'.mjs', '.py', '.ps1'},
}
ASSET_DIRECTORIES = ('app', 'bosses', 'characters', 'circuits', 'elements')
ASSET_TYPES = {'.webp', '.png', '.jpg', '.jpeg', '.svg', '.ico'}
OMITTED_PARTS = {
    '.git', '.codex', '.agents', '__pycache__', 'node_modules',
    'raw', 'runtime', 'outputs', 'build', 'dist',
}
REQUIRED_FILES = {
    'assets/app/lily.png', 'assets/app/lily.ico',
    'assets/characters/Lily_UserPortrait_v1.png', 'tests/score-input.test.mjs',
    'tests/server.test.mjs', 'tests/test_season_generation.py', 'tools/lily_smoke.mjs',
    'tools/input_visibility_filters_smoke.mjs', 'tools/disable_cleanup_egg_smoke.mjs',
    'tools/guaranteed_roles_smoke.mjs', 'tools/disabled_plan_scope_smoke.mjs',
    'plan-library.js', 'season-config.js', 'config/seasons.json',
    'config/seasons/s2-3.json', 'config/seasons/s2-4.json',
    'data/matrix_content_16.json', 'data/matrix_content_18.json',
    'tools/boss_details_smoke.mjs', 'tools/matrix_plans_smoke.mjs',
    'tools/boss_properties_smoke.mjs', 'tools/pending_delete_smoke.mjs',
    'tools/picker_overview_smoke.mjs',
    'config/character_order.json', 'data/character_search.json', 'data/s2_4_score_source.json',
    'assets/characters/Rover_Combined_v1.png', 'tools/update_s2_4_scores.py',
    'tools/features_1_2_smoke.mjs', 'tools/picker_animation_smoke.mjs',
    'tools/drag_preview_smoke.mjs', 'tools/pinyin_search_smoke.mjs',
    'tools/rover_merge_smoke.mjs', 'tools/picker_order_sidebar_smoke.mjs',
    'tools/score_table_migration_smoke.mjs', 'tests/test_s2_4_scoring.py',
    'tests/season-config.test.mjs',
}
BROWSER_FILE_LIMIT = 25 * 1024 * 1024
UPLOAD_DOC = 'https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository'
RELEASE_DOC = 'https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository'


def source_files():
    """Select source explicitly; exclude Git metadata, cache and personal exports."""
    selected = set(ROOT_FILES)
    selected.update(f'desktop/{name}' for name in DESKTOP_FILES)
    for directory, suffixes in TREE_TYPES.items():
        for file in (ROOT / directory).rglob('*'):
            relative = file.relative_to(ROOT)
            if file.is_file() and file.suffix.lower() in suffixes and not (set(relative.parts) & OMITTED_PARTS):
                selected.add(relative.as_posix())
    selected.update(file.relative_to(ROOT).as_posix() for file in (ROOT / 'data').glob('*.json') if file.is_file())
    for directory in ASSET_DIRECTORIES:
        for file in (ROOT / 'assets' / directory).rglob('*'):
            if file.is_file() and file.suffix.lower() in ASSET_TYPES:
                selected.add(file.relative_to(ROOT).as_posix())
    files = []
    root = ROOT.resolve()
    for name in sorted(selected):
        file = ROOT / name
        if not file.is_file():
            raise ValueError(f'Required source file is missing: {name}')
        if file.is_symlink() or not file.resolve().is_relative_to(root):
            raise ValueError(f'Source path must stay inside project: {name}')
        if set(Path(name).parts) & OMITTED_PARTS:
            raise ValueError(f'Unexpected output or private path: {name}')
        if file.stat().st_size > BROWSER_FILE_LIMIT:
            raise ValueError(f'File exceeds GitHub browser upload limit of 25 MiB: {name}')
        if file.suffix.lower() == '.json' and name not in {'config/demo.json', 'config/alternate-demo.json'}:
            data = json.loads(file.read_text(encoding='utf-8-sig'))
            if isinstance(data, dict) and (isinstance(data.get('teams'), list) or isinstance(data.get('plans'), list)):
                raise ValueError(f'Unexpected saved team-plan JSON in source selection: {name}')
        files.append(name)
    if not REQUIRED_FILES.issubset(files):
        raise ValueError(f'Missing current source: {sorted(REQUIRED_FILES - set(files))}')
    if not any(name.startswith('assets/circuits/') for name in files):
        raise ValueError('Circuit icons are missing from source selection')
    return files


def upload_guide(version, short_version, core_count, asset_count):
    return f'''鸣潮终焉矩阵血线排布 V{short_version} — GitHub 上传说明

源码目录：github-upload-v{short_version}/wuwa-matrix-planner
源码压缩包：WuwaMatrixPlanner-v{version}-source.zip
可运行软件：WuwaMatrixPlanner-v{version}-win-x64.zip

一、更新仓库源码
1. 打开现有仓库 https://github.com/KazamiSora/wuwa-matrix-planner 。
2. 在仓库首页点 Add file → Upload files。
3. 打开本说明同级的 wuwa-matrix-planner 文件夹，进入直接能看到 README.md、app.js 的那一层。
4. 第一批：选中除 assets 之外的所有内容，连同 config、data、desktop、docs、tests、tools 文件夹一起拖入上传区，共 {core_count} 个文件。提交说明填“更新 V{short_version} 源码与配置”，点击 Commit changes。
5. 第二批：重新在仓库根目录进入 Upload files，把 assets 整个文件夹拖入，共 {asset_count} 个文件。提交说明填“更新 V{short_version} 角色、Boss 与回路素材”，点击 Commit changes。
6. 同路径文件会被更新，新增文件会加入仓库。完成后仓库根目录应直接显示 README.md、app.js、plan-library.js、season-config.js、assets、config 等。

请拖入文件夹里面的内容，不要把 wuwa-matrix-planner 总文件夹再套到仓库里；也不要只上传源码 ZIP，GitHub 不会替你展开。
两批总计 {core_count + asset_count} 个文件。GitHub 网页每次最多上传 100 个文件、单文件最多 25 MiB；以上两批和每个文件均已按此限制检查。

二、发布 V{short_version} 软件
1. 源码两批都提交后，进入仓库的 Releases，点 Draft a new release。
2. 新建标签 v{version}，Target 选择 main，标题填写 V{short_version}。
3. 说明正文可复制 dist 下的 V{short_version}发布说明.txt；附件上传 WuwaMatrixPlanner-v{version}-win-x64.zip 和 SHA256SUMS.txt。需要时也可附上 WuwaMatrixPlanner-v{version}-source.zip。
4. 确认文件已传完后点 Publish release。旧版本的 Release 保留即可。

软件 ZIP 放在 Release 附件里，不要放到源码根目录。源码压缩包不含 Node.js 运行时；给普通用户下载的是 win-x64 软件包。

三、升级自己的排布
先在旧版逐套导出需要保留的排布 JSON，再从系统托盘选择“退出软件”。将 V{short_version} 完整解压到新目录运行；若旧排布没有自动出现，可在新版本逐套导入 JSON。

本次源码包包含两个赛季的 JSON、增益图标、Boss 特殊性质与搜索、5000 分待填队伍预览、两步队伍删除撤回和恢复、队伍排布库及相关检查脚本。快捷组队窗口已扩大，体力文字放在头像左上角；主界面可打开“队伍一览”，快捷选人左侧也能查看已有队伍和本次组队草稿。

源码未打包浏览器个人数据、个人排布导出、运行日志或原始网页快照。

GitHub 官方说明：
上传文件：{UPLOAD_DOC}
发布 Release：{RELEASE_DOC}
'''


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Check selected files and print counts without writing output')
    args = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Expected numeric major.minor.patch package version')
    # Patch releases need their own upload folder and full visible version.
    short_version = version if int(version.split('.')[2]) else '.'.join(version.split('.')[:2])
    files = source_files()
    core = [name for name in files if not name.startswith('assets/')]
    assets = [name for name in files if name.startswith('assets/')]
    if max(len(core), len(assets)) > 100:
        raise ValueError('Source exceeds two browser-upload batches; update upload instructions before packaging')
    report = {'version': version, 'files': len(files), 'core_files': len(core), 'asset_files': len(assets),
              'total_bytes': sum((ROOT / name).stat().st_size for name in files)}
    if args.dry_run:
        print(json.dumps(report, ensure_ascii=False))
        return
    dist = (ROOT / 'dist').resolve()
    dist.mkdir(exist_ok=True)
    upload_parent = dist / f'github-upload-v{short_version}'
    source_root = upload_parent / 'wuwa-matrix-planner'
    # Replace only this generated version-specific source copy; keep older versions.
    resolved = source_root.resolve()
    if (source_root.is_symlink() or resolved != dist / f'github-upload-v{short_version}' / 'wuwa-matrix-planner'
            or not resolved.is_relative_to(dist) or resolved == dist):
        raise ValueError('Unsafe generated source-folder destination')
    if source_root.exists():
        shutil.rmtree(resolved)
    source_root.mkdir(parents=True)
    for name in files:
        target = source_root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    archive_path = dist / f'WuwaMatrixPlanner-v{version}-source.zip'
    archive_prefix = f'WuwaMatrixPlanner-v{version}-source'
    with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in files:
            info = zipfile.ZipInfo(f'{archive_prefix}/{name}', date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (source_root / name).read_bytes(), compresslevel=9)
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    checksum = dist / f'WuwaMatrixPlanner-v{version}-source.sha256'
    checksum.write_text(f'{digest}  {archive_path.name}\n', encoding='ascii')
    (upload_parent / 'GitHub上传说明.txt').write_text(upload_guide(version, short_version, len(core), len(assets)), encoding='utf-8-sig')
    manifest = {
        **report, 'archive': archive_path.name, 'sha256': digest,
        'source_directory': source_root.relative_to(dist).as_posix(),
        'files_detail': [{'path': name, 'bytes': (ROOT / name).stat().st_size,
                          'sha256': hashlib.sha256((source_root / name).read_bytes()).hexdigest()} for name in files],
    }
    (upload_parent / 'source-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({**report, 'archive': str(archive_path), 'source_directory': str(source_root), 'sha256': digest}, ensure_ascii=False))


if __name__ == '__main__':
    main()
