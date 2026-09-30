using System.Text.Json;
using Xunit;
namespace Uma.Agent.Core.Tests;
public class CoreTests
{
 [Fact] public void Train_mode_follows_contract(){Assert.Equal(TrainMode.independent,TrainModeDetector.Detect(" Independent Learner "));Assert.Equal(TrainMode.manual,TrainModeDetector.Detect("Monarch"));}
 [Fact] public void Dhash_matches_shared_vectors(){var cases=new[]{(90,80,"gradient-x-asc","0000000000000000"),(90,80,"gradient-x-desc","ffffffffffffffff"),(64,64,"gradient-y","0000000000000000")};foreach(var c in cases){var data=new byte[c.Item1*c.Item2*4];for(int y=0;y<c.Item2;y++)for(int x=0;x<c.Item1;x++){var p=(y*c.Item1+x)*4;var v=c.Item3 switch{"gradient-x-asc"=>x*255/(c.Item1-1),"gradient-x-desc"=>255-x*255/(c.Item1-1),_=>y*255/(c.Item2-1)};data[p]=(byte)v;data[p+1]=(byte)v;data[p+2]=(byte)v;data[p+3]=255;}Assert.Equal(c.Item4,PixelAlgorithms.DHash(new Frame(data,c.Item1,c.Item2)));}}
 [Fact] public void Fingerprint_is_order_independent(){var v=new Veteran("character:a","outfit:b","A+",1,"x",TrainMode.manual,new(1,2,3,4,5),new(new(){{"turf","A"},{"dirt","G"},{"sprint","G"},{"mile","A"},{"medium","A"},{"long","C"},{"front","G"},{"pace","A"},{"late","B"},{"end","G"}}),new(),new(){new("self","spark:b","pink",1),new("self","spark:a","blue",2)},new(),new(){new(1,"character:c",null,false,null),new(2,"character:d",null,false,null)},"scenario:x",new(1,1,null,"2026-01-01"));var w=v with{Sparks=((IEnumerable<Spark>)v.Sparks).Reverse().ToList()};Assert.Equal(Fingerprint.Hash(v),Fingerprint.Hash(w));}
 [Fact] public void All_fixture_labels_exist(){var root=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../../../../fixtures/labels"));Assert.Equal(15,Directory.GetFiles(root,"*.json").Length);}
 [Fact] public async Task Recorded_ocr_classifies_all_screens(){var root=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../../../../fixtures/ocr"));foreach(var p in Directory.GetFiles(root)){var e=new FixtureOcrEngine(p);var lines=await e.ReadAsync(new Frame(Array.Empty<byte>(),1920,1080),new Rect(0,0,1920,1080),OcrMode.Text);Assert.NotEqual(ScreenId.Unknown,new ScreenClassifier().Classify(lines).Id);}}
}
