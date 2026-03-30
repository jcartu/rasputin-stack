#!/bin/bash
# ALFIE CLI bash completion script
# Install: alfie completion bash --install
# Or: source <(alfie completion bash)

_alfie_completions() {
    local cur prev opts commands
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"
    
    # Top-level commands
    commands="chat search session file export import config completion status consensus verify procedure"
    
    # Global options
    global_opts="-h --help -v --version -q --quiet --no-color -c --config"
    
    # Command-specific completions
    case "${COMP_WORDS[1]}" in
        chat)
            opts="-m --model -t --temperature --no-context --max-tokens -s --system -o --output --history"
            ;;
        search)
            opts="-n --limit -t --threshold -c --collection -f --filter -o --output --stats"
            ;;
        session)
            local session_cmds="list show delete new resume"
            if [[ ${COMP_CWORD} -eq 2 ]]; then
                COMPREPLY=( $(compgen -W "${session_cmds}" -- ${cur}) )
                return 0
            fi
            case "${COMP_WORDS[2]}" in
                list|ls)
                    opts="-n --limit --all -o --output"
                    ;;
                show)
                    opts="--messages -o --output"
                    ;;
                delete|rm)
                    opts="-f --force"
                    ;;
                new)
                    opts="-n --name -m --model"
                    ;;
            esac
            ;;
        file)
            local file_cmds="list read write search info"
            if [[ ${COMP_CWORD} -eq 2 ]]; then
                COMPREPLY=( $(compgen -W "${file_cmds}" -- ${cur}) )
                return 0
            fi
            case "${COMP_WORDS[2]}" in
                list|ls)
                    opts="-a --all -l --long -r --recursive --pattern"
                    COMPREPLY=( $(compgen -f -d -- ${cur}) )
                    ;;
                read|cat)
                    opts="-n --lines --head --tail -o --output"
                    COMPREPLY=( $(compgen -f -- ${cur}) )
                    ;;
                write)
                    opts="-c --content -a --append -f --force"
                    COMPREPLY=( $(compgen -f -- ${cur}) )
                    ;;
                search|grep)
                    opts="-i --ignore-case -r --recursive -n --line-numbers --include --context"
                    ;;
                info)
                    COMPREPLY=( $(compgen -f -- ${cur}) )
                    ;;
            esac
            ;;
        export)
            local export_cmds="sessions memories config workspace"
            if [[ ${COMP_CWORD} -eq 2 ]]; then
                COMPREPLY=( $(compgen -W "${export_cmds}" -- ${cur}) )
                return 0
            fi
            case "${COMP_WORDS[2]}" in
                sessions)
                    opts="-a --all -n --limit -f --format --since"
                    ;;
                memories)
                    opts="-n --limit -t --threshold -f --format"
                    ;;
                config)
                    opts="--include-keys"
                    ;;
                workspace)
                    opts="--include --exclude"
                    ;;
            esac
            ;;
        import)
            local import_cmds="sessions config workspace"
            if [[ ${COMP_CWORD} -eq 2 ]]; then
                COMPREPLY=( $(compgen -W "${import_cmds}" -- ${cur}) )
                return 0
            fi
            opts="-f --force --dry-run"
            COMPREPLY=( $(compgen -f -- ${cur}) )
            ;;
        config)
            local config_cmds="get set reset list edit"
            if [[ ${COMP_CWORD} -eq 2 ]]; then
                COMPREPLY=( $(compgen -W "${config_cmds}" -- ${cur}) )
                return 0
            fi
            case "${COMP_WORDS[2]}" in
                get)
                    opts="--json"
                    ;;
                reset)
                    opts="-f --force"
                    ;;
                list)
                    opts="--show-keys"
                    ;;
            esac
            ;;
        completion)
            local completion_cmds="bash zsh setup"
            if [[ ${COMP_CWORD} -eq 2 ]]; then
                COMPREPLY=( $(compgen -W "${completion_cmds}" -- ${cur}) )
                return 0
            fi
            opts="-o --output --install"
            ;;
        consensus)
            opts="-t --type --temperature --timeout -o --output --models --no-local --no-cloud"
            ;;
        verify)
            opts="-c --category -s --sources -o --output --threshold"
            ;;
        procedure|proc)
            local proc_cmds="list search create show stats"
            if [[ ${COMP_CWORD} -eq 2 ]]; then
                COMPREPLY=( $(compgen -W "${proc_cmds}" -- ${cur}) )
                return 0
            fi
            case "${COMP_WORDS[2]}" in
                list|ls)
                    opts="-t --tag -o --output"
                    ;;
                search)
                    opts="-n --limit"
                    ;;
                show)
                    opts="-o --output"
                    ;;
            esac
            ;;
        status)
            opts="--json --verbose"
            ;;
        *)
            COMPREPLY=( $(compgen -W "${commands}" -- ${cur}) )
            return 0
            ;;
    esac
    
    if [[ ${cur} == -* ]]; then
        COMPREPLY=( $(compgen -W "${opts} ${global_opts}" -- ${cur}) )
    elif [[ -n "${opts}" ]]; then
        COMPREPLY=( $(compgen -W "${opts}" -- ${cur}) )
    fi
}

complete -F _alfie_completions alfie
