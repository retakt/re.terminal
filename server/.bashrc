# re.Term — PTY .bashrc
# Loaded by the PTY on every new session

export TERM=xterm-256color
export COLORTERM=truecolor

# Source the real root bashrc so all env vars, aliases, and PATH are loaded
if [ -f /root/.bashrc ]; then
  source /root/.bashrc
fi

# Start in home directory
cd ~

# Standard color aliases
alias ls='ls --color=auto'
alias grep='grep --color=auto'
alias diff='diff --color=auto'

# Prompt: cyan user@host, white path, $
PS1='\[\e[36m\]\u@\h\[\e[0m\]:\[\e[1m\]\w\[\e[0m\]\$ '
