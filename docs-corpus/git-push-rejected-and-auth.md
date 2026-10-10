# Git push problems

## Rejected push

`! [rejected] main -> main (non-fast-forward)` or `failed to push some refs` means the remote has
commits you do not have. Run `git pull --rebase`, resolve conflicts, then push again. Do not force
push shared branches.

## Authentication

`Permission denied (publickey)` means the SSH key is not loaded or not added to the account. Check
`ssh -T git@github.com` and `ssh-add -l`. `Authentication failed` over HTTPS usually needs a personal
access token instead of a password.
