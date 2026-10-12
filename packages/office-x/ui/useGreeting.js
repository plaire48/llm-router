import {useEffect,useState} from 'react';
import {chooseGreeting,greetingPeriod} from './greetings.js';
const key='office-welcome-greeting';
function previous(){try{return sessionStorage.getItem(key)||'';}catch{return '';}}
export function useGreeting(){
  const [greeting,setGreeting]=useState(()=>chooseGreeting(new Date(),previous()));
  useEffect(()=>{try{sessionStorage.setItem(key,greeting.id);}catch{}},[greeting.id]);
  useEffect(()=>{
    const refresh=()=>{const date=new Date();setGreeting(current=>current.period===greetingPeriod(date).id?current:chooseGreeting(date,current.id));};
    const timer=setInterval(refresh,60000);
    window.addEventListener('focus',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  return greeting.text;
}
