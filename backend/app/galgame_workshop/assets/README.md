# Galgame renderer assets

`NotoSansSC-Regular.ttf` and `NotoSansSC-Medium.ttf` are the fixed CJK fonts used by the
deterministic dialogue renderer. They are distributed under the SIL Open Font License 1.1;
see `OFL.txt`.

Both fonts are tracked with Git LFS. Run `git lfs pull --include="backend/app/galgame_workshop/assets/*.ttf" --exclude=""`
when they are still pointer files, then verify them with `python3 scripts/check_lfs_assets.py --backend`.
