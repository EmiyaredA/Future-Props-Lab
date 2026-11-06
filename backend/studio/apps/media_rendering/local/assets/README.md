# Shared media renderer assets

`NotoSansSC-Regular.ttf` and `NotoSansSC-Medium.ttf` are the fixed CJK fonts used by the
deterministic dialogue and video-editor text renderers. They are distributed under the SIL Open Font License 1.1;
see `OFL.txt`.

Both fonts are tracked with Git LFS. Run `git lfs pull --include="backend/studio/apps/media_rendering/local/assets/*.ttf" --exclude=""`
when they are still pointer files, then verify them with `python3 scripts/checks/check_lfs_assets.py --backend`.
