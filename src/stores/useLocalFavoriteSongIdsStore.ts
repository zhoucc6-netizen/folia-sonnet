import { create } from 'zustand';

// src/stores/useLocalFavoriteSongIdsStore.ts
//
// 本地「我喜欢的」那份歌单里有哪些 songId。
//
// 喜欢状态本来只在播放控制器里现算（localPlaylists.find(isFavorite)），但排序要在列表层知道
// 每一首歌喜不喜欢，而列表拿不到 localPlaylists。与其把歌单列表一路传进每个 suite，不如让宿主
// 在它变化的时候同步到这里一份——排序只读，不写。

type LocalFavoriteSongIdsState = {
    songIds: ReadonlySet<string>;
    setSongIds: (songIds: ReadonlySet<string>) => void;
};

export const useLocalFavoriteSongIdsStore = create<LocalFavoriteSongIdsState>(set => ({
    songIds: new Set(),
    setSongIds: (songIds) => set({ songIds }),
}));

export const setLocalFavoriteSongIds = (songIds: ReadonlySet<string>): void => {
    useLocalFavoriteSongIdsStore.getState().setSongIds(songIds);
};
