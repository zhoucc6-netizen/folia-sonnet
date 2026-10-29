import { ArrowDownUp, CalendarClock, Clock, FolderSync, Heart, ImagePlus, ListMusic, ListOrdered, PanelLeft, PanelRight, Pencil, Play, RefreshCw, Share, SquarePen, Star, Tags, Type, User } from 'lucide-react';
import { createGridSurfaceCommand } from '../commandFactories';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/gridCommands.ts
// The track grid's own controls, reachable from the keyboard.
//
// Every one of these existed only as a button or a dropdown item inside GridView, each gated on its
// own branch — sorting is a local-folder idea, reimport is a folder idea, export is a playlist idea.
// The gating is not repeated here: the grid publishes which of them apply right now and the factory
// asks that list, so the panel and the palette cannot drift apart.
//
// None of them carry an `executeShortcut`. Reimport and "organize song info" walk the disk and the
// network; the rest are contextual state that would spend a global prefix for a key that means
// nothing on most screens.

export const gridCommands: CommandPaletteCommand[] = [
    createGridSurfaceCommand(
        'grid-sort-newest',
        'Sort by newest',
        'Order the tracks by when they were added, newest first',
        ['sort newest', 'newest first', '从新到旧', '最新'],
        'sort-newest',
        Clock,
    ),
    createGridSurfaceCommand(
        'grid-sort-oldest',
        'Sort by oldest',
        'Order the tracks by when they were added, oldest first',
        ['sort oldest', 'oldest first', '从旧到新', '最早'],
        'sort-oldest',
        Clock,
    ),
    createGridSurfaceCommand(
        'grid-sort-title',
        'Sort by song name',
        'Order the tracks by their name, A to Z',
        ['sort name', 'song name', '歌曲名', '按歌名'],
        'sort-title',
        Type,
    ),
    createGridSurfaceCommand(
        'grid-sort-artist',
        'Sort by artist name',
        'Order the tracks by their artist, A to Z',
        ['sort artist', 'singer', '歌手', '按歌手'],
        'sort-artist',
        User,
    ),
    createGridSurfaceCommand(
        'grid-sort-liked-desc',
        'Sort by most liked',
        'Put the songs you like at the top',
        ['sort liked', 'favorite first', '喜欢程度', '最喜欢的在前'],
        'sort-liked-desc',
        Heart,
    ),
    createGridSurfaceCommand(
        'grid-sort-liked-asc',
        'Sort by least liked',
        'Put the songs you have not liked at the top',
        ['sort unliked', 'not liked first', '喜欢程度低', '不喜欢的在前'],
        'sort-liked-asc',
        Heart,
    ),
    createGridSurfaceCommand(
        'grid-sort-play-count-desc',
        'Sort by most played',
        'Order the tracks by play count, highest first',
        ['sort plays', 'most played', '播放量', '听得多'],
        'sort-play-count-desc',
        Play,
    ),
    createGridSurfaceCommand(
        'grid-sort-play-count-asc',
        'Sort by least played',
        'Order the tracks by play count, lowest first',
        ['sort plays ascending', 'least played', '播放量低', '听得少'],
        'sort-play-count-asc',
        Play,
    ),
    createGridSurfaceCommand(
        'grid-sort-default',
        'Restore the original order',
        'Stop sorting and show the collection the way the source ordered it',
        ['sort default', 'original order', '默认顺序', '原序'],
        'sort-default',
        ListMusic,
    ),
    createGridSurfaceCommand(
        'grid-sort-file-name',
        'Sort by file name',
        'Order the local tracks by their file name',
        ['sort filename', '按文件名'],
        'sort-file-name',
        Type,
    ),
    createGridSurfaceCommand(
        'grid-sort-modified-date',
        'Sort by modified date',
        'Order the local tracks by when the file was last changed',
        ['sort date', 'mtime', '按修改时间'],
        'sort-file-modified',
        CalendarClock,
    ),
    createGridSurfaceCommand(
        'grid-sort-album-track',
        'Sort by album track number',
        'Order the local tracks by disc and track number',
        ['sort track number', '按音轨号'],
        'sort-album-track',
        ListOrdered,
    ),
    createGridSurfaceCommand(
        'grid-sort-direction',
        'Reverse sort order',
        'Switch the local track list between ascending and descending',
        ['reverse', 'ascending', 'descending', '倒序', '升序'],
        'sort-toggle-direction',
        ArrowDownUp,
    ),
    createGridSurfaceCommand(
        'grid-toggle-info-panel',
        'Toggle collection panel',
        'Show or hide the collection info and actions panel',
        ['collection info', 'cut in panel', '合集信息'],
        'toggle-info-panel',
        PanelLeft,
    ),
    createGridSurfaceCommand(
        'grid-toggle-track-list',
        'Toggle track list',
        'Show or hide the track list beside the grid',
        ['track list', 'side panel', '曲目列表'],
        'toggle-track-list',
        PanelRight,
    ),
    createGridSurfaceCommand(
        'grid-resync-folder',
        'Reimport this folder',
        'Scan this local folder again and refresh its songs',
        ['rescan', 'reimport folder', '重新扫描'],
        'resync-folder',
        RefreshCw,
    ),
    createGridSurfaceCommand(
        'grid-resync-all-folders',
        'Reimport every folder',
        'Scan every local folder again and refresh the library',
        ['rescan all', 'reimport library', '重新扫描全部'],
        'resync-all-folders',
        FolderSync,
    ),
    createGridSurfaceCommand(
        'grid-organize-song-info',
        'Organize song info',
        'Clean up the titles, artists and albums of this folder',
        ['tags', 'metadata', '元数据'],
        'organize-song-info',
        Tags,
    ),
    createGridSurfaceCommand(
        'grid-export-playlist',
        'Export this playlist',
        'Save this local playlist as an m3u8 file',
        ['m3u8', 'export', '导出'],
        'export-playlist',
        Share,
    ),
    createGridSurfaceCommand(
        'grid-edit-entity',
        'Edit this album or artist',
        'Open the local library entity editor for this collection',
        ['rename album', 'merge artist', '实体编辑'],
        'edit-entity',
        SquarePen,
    ),
    createGridSurfaceCommand(
        'grid-set-cover',
        'Set collection cover',
        'Choose a fixed cover for this local folder, album or playlist',
        ['cover', 'poster', 'artwork', '封面', '设置封面'],
        'set-cover',
        ImagePlus,
    ),
    createGridSurfaceCommand(
        'grid-toggle-edit-mode',
        'Toggle edit mode',
        'Enter or leave the mode that lets you remove songs from this collection',
        ['edit playlist', 'manage songs', '编辑模式'],
        'toggle-edit-mode',
        Pencil,
    ),
    createGridSurfaceCommand(
        'grid-reload-online-collection',
        'Reload this collection',
        'Skip the cache and load every song of this online collection again',
        ['reload', 'refresh', 'resync', '重新加载', '刷新'],
        'reload-online-collection',
        RefreshCw,
    ),
    // 与信息面板封面上的星标按钮同一个动作（变更控制器的 toggleSubscribe）；标题不随状态变，面板没有动态标题。
    createGridSurfaceCommand(
        'grid-toggle-subscribe',
        'Subscribe or unsubscribe',
        'Save this online playlist or album to your library, or remove it if it is already there',
        ['subscribe', 'unsubscribe', 'favorite', 'save album', '收藏', '取消收藏', '订阅'],
        'toggle-subscribe',
        Star,
    ),
];
