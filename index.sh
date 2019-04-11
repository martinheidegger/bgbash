#!/bin/bash

outtmp=$(mktemp)
errtmp=$(mktemp)
here=$(dirname $0)

x_find () {
  find "$@" -printf "%s"
}

x_gfind () {
  gfind "$@" -printf "%s"
}

x_wc () {
  wc -c <"$@"
}

usefirst () {
  for cmd in $@
  do
    data=`$cmd $here/test/mutual.png 2>/dev/null`
    if (( data == 2272 )) 2>/dev/null; then
      echo $cmd
      return
    fi
  done
}

sizecmd=$(usefirst \
  "du --apparent-size --block-size=1" \
  "gdu --apparent-size --block-size=1" \
  x_find \
  x_gfind \
  "stat --printf=\"%s\"" \
  x_wc
)

render () {
  len=`$sizecmd $@`
  printf "%014x" $len
  cat $@
  rm $@
}

run () {
  cmd=$@
  bash -c "$cmd" >"$outtmp" 2>"$errtmp"
  printf "%02x" $?
  render $outtmp
  render $errtmp
}

while IFS='$\n' read -r cmd
do
  if [[ "${cmd}" == "SIGTERM" ]]; then
    exit
  fi
  run $cmd
done < /dev/stdin

